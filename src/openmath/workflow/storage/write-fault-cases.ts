import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { basename, join } from "node:path"
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"

import { compareAndSwapWorkflowState } from "./compare-and-swap"
import { nodeStorageRuntime } from "./node-storage-runtime"
import { getWorkflowRunDirectory } from "./run-directory-hash"
import { getWorkflowRevisionPath } from "./revision-filename"
import { startWorkflowState } from "./start-reservation"
import type { StorageFileHandle, StorageRuntime } from "./storage-runtime-contract"
import { createStoredWorkflowState } from "./storage-test-state"

const WRITE_FAULTS = ["write", "file-sync", "close", "publication", "directory-sync"] as const
type WriteFault = (typeof WRITE_FAULTS)[number]

function fault(code: string): Error & { readonly code: string } {
  return Object.assign(new Error(`Injected ${code}`), { code })
}

function wrapHandle(handle: StorageFileHandle, path: string, flags: string, injected: WriteFault): StorageFileHandle {
  const temporary = basename(path).startsWith(".tmp-")
  const directory = flags === "r"
  return {
    readFile: async () => handle.readFile(),
    identity: async () => handle.identity(),
    writeFile: async (content) => {
      if (temporary && injected === "write") throw fault("EIO")
      await handle.writeFile(content)
    },
    sync: async () => {
      if (temporary && injected === "file-sync") throw fault("EIO")
      if (directory && injected === "directory-sync") throw fault("EIO")
      await handle.sync()
    },
    close: async () => {
      await handle.close()
      if (temporary && injected === "close") throw fault("EIO")
    },
  }
}

function runtimeWithFault(injected: WriteFault): StorageRuntime {
  return {
    ...nodeStorageRuntime,
    open: async (path, flags) => wrapHandle(await nodeStorageRuntime.open(path, flags), path, flags, injected),
    link: async (source, destination) => {
      if (injected === "publication" && basename(destination).startsWith("state.rev-")) throw fault("EIO")
      await nodeStorageRuntime.link(source, destination)
    },
  }
}

export function registerWriteFaultCases(): void {
  describe("workflow atomic write faults", () => {
    let directory: string

    beforeEach(() => {
      directory = mkdtempSync(join(tmpdir(), "openmath-workflow-write-fault-"))
    })

    afterEach(() => {
      rmSync(directory, { recursive: true, force: true })
    })

    for (const injected of WRITE_FAULTS) {
      test(`preserves revision zero and cleans owned temps when ${injected} fails`, async () => {
        // given
        const state = createStoredWorkflowState(`fault-${injected}`, 0)
        await startWorkflowState({ directory, state })
        const runDirectory = getWorkflowRunDirectory(directory, state.run_id)
        const revisionZero = getWorkflowRevisionPath(runDirectory, 0)
        const previousBytes = readFileSync(revisionZero, "utf8")

        // when
        const result = await compareAndSwapWorkflowState({
          directory,
          run_id: state.run_id,
          expected_state_revision: 0,
          next_state: { ...state, intervention_satisfied: true },
        }, runtimeWithFault(injected))

        // then
        expect(result).toMatchObject({ kind: "error", error_code: "STORAGE_WRITE_FAILED" })
        expect(readFileSync(revisionZero, "utf8")).toBe(previousBytes)
        expect(readdirSync(runDirectory).filter((name) => name.startsWith(".tmp-"))).toEqual([])
        expect(existsSync(getWorkflowRevisionPath(runDirectory, 1))).toBe(injected === "directory-sync")
      })
    }

    test("returns atomicity unavailable for unsupported lock and temp exclusive create", async () => {
      // given
      const lockState = createStoredWorkflowState("unsupported-lock-create", 0)
      const unsupportedLock = { ...nodeStorageRuntime, writeExclusive: async () => { throw fault("ENOTSUP") } }
      const tempState = createStoredWorkflowState("unsupported-temp-create", 0)
      await startWorkflowState({ directory, state: tempState })
      const unsupportedTemp: StorageRuntime = {
        ...nodeStorageRuntime,
        open: async (path, flags) => {
          if (flags === "wx") throw fault("EOPNOTSUPP")
          return nodeStorageRuntime.open(path, flags)
        },
      }

      // when
      const lockResult = await startWorkflowState({ directory, state: lockState }, unsupportedLock)
      const tempResult = await compareAndSwapWorkflowState({
        directory,
        run_id: tempState.run_id,
        expected_state_revision: 0,
        next_state: tempState,
      }, unsupportedTemp)

      // then
      expect(lockResult).toMatchObject({ kind: "error", error_code: "STORAGE_ATOMICITY_UNAVAILABLE" })
      expect(tempResult).toMatchObject({ kind: "error", error_code: "STORAGE_ATOMICITY_UNAVAILABLE" })
    })

    test("returns atomicity unavailable when atomic no-replace publication is unsupported", async () => {
      // given
      const state = createStoredWorkflowState("unsupported-rename", 0)
      await startWorkflowState({ directory, state })
      const runtime: StorageRuntime = {
        ...nodeStorageRuntime,
        link: async (source, destination) => {
          if (basename(destination).startsWith("state.rev-")) throw fault("EXDEV")
          await nodeStorageRuntime.link(source, destination)
        },
      }

      // when
      const result = await compareAndSwapWorkflowState({
        directory,
        run_id: state.run_id,
        expected_state_revision: 0,
        next_state: state,
      }, runtime)

      // then
      expect(result).toMatchObject({ kind: "error", error_code: "STORAGE_ATOMICITY_UNAVAILABLE" })
      const runDirectory = getWorkflowRunDirectory(directory, state.run_id)
      expect(existsSync(getWorkflowRevisionPath(runDirectory, 1))).toBe(false)
      expect(readdirSync(runDirectory).filter((name) => name.startsWith(".tmp-"))).toEqual([])
    })
  })
}
