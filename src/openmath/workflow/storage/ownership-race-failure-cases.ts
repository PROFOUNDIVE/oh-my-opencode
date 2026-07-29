import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"

import { writeImmutableWorkflowRevision } from "./atomic-writer"
import { nodeStorageRuntime } from "./node-storage-runtime"
import { getWorkflowRevisionPath } from "./revision-filename"
import type { StorageRuntime } from "./storage-runtime-contract"
import { createStoredWorkflowState } from "./storage-test-state"
import { acquireWorkflowWriteLock, releaseWorkflowWriteLock } from "./write-lock"

function record(token: string, pid: number, startedAt: string): string {
  return JSON.stringify({ token, pid, started_at: startedAt })
}

export function registerOwnershipRaceFailureCases(): void {
  describe("workflow storage ownership races", () => {
    let directory: string

    beforeEach(() => {
      directory = mkdtempSync(join(tmpdir(), "openmath-workflow-ownership-race-"))
    })

    afterEach(() => {
      rmSync(directory, { recursive: true, force: true })
    })

    test("does not overwrite a revision allocated immediately before publication", async () => {
      // given
      const state = createStoredWorkflowState("publication-race", 1)
      const revisionPath = getWorkflowRevisionPath(directory, 1)
      const sentinel = "RACING_ALLOCATION"
      const runtime: StorageRuntime = {
        ...nodeStorageRuntime,
        link: async (source, destination) => {
          if (destination === revisionPath) writeFileSync(destination, sentinel, "utf8")
          await nodeStorageRuntime.link(source, destination)
        },
      }

      // when
      const result = await writeImmutableWorkflowRevision({ run_directory: directory, revision: 1, state }, runtime)

      // then
      expect(result).toMatchObject({ kind: "error", error_code: "STORAGE_WRITE_FAILED" })
      expect(readFileSync(revisionPath, "utf8")).toBe(sentinel)
    })

    test("release preserves a replacement installed after the owner record is read", async () => {
      // given
      const lockPath = join(directory, ".write.lock")
      const startedAt = "2026-07-29T12:00:00.000Z"
      const owner = record("original-owner", process.pid, startedAt)
      const replacement = record("replacement-owner", process.pid, startedAt)
      writeFileSync(lockPath, owner)
      let handedOff = false
      const handoff = () => {
        if (handedOff) return
        handedOff = true
        unlinkSync(lockPath)
        writeFileSync(lockPath, replacement)
      }
      const runtime: StorageRuntime = {
        ...nodeStorageRuntime,
        open: async (path, flags) => {
          if (path === lockPath && flags === "r") handoff()
          return nodeStorageRuntime.open(path, flags)
        },
        readFile: async (path) => {
          const content = await nodeStorageRuntime.readFile(path)
          if (path === lockPath) handoff()
          return content
        },
        rename: async (source, destination) => {
          if (source === lockPath) handoff()
          await nodeStorageRuntime.rename(source, destination)
        },
      }

      // when
      const result = await releaseWorkflowWriteLock({ run_directory: directory, token: "original-owner" }, runtime)

      // then
      expect(result).toMatchObject({ kind: "ok" })
      expect(readFileSync(lockPath, "utf8")).toBe(replacement)
    })

    test("stale recovery preserves a live replacement installed after stale inspection", async () => {
      // given
      const lockPath = join(directory, ".write.lock")
      const stalePath = join(directory, ".stale-lock-stale-owner")
      const stale = record("stale-owner", 2_147_483_647, "2026-07-29T12:00:00.000Z")
      const replacement = record("live-replacement", process.pid, "2026-07-29T12:00:31.000Z")
      writeFileSync(lockPath, stale)
      let currentTime = Date.parse("2026-07-29T12:00:31.000Z")
      let handedOff = false
      const runtime: StorageRuntime = {
        ...nodeStorageRuntime,
        now: () => currentTime,
        sleep: async (milliseconds) => {
          currentTime += milliseconds
        },
        open: async (path, flags) => {
          if (path === lockPath && flags === "r" && !handedOff) {
            handedOff = true
            unlinkSync(lockPath)
            writeFileSync(lockPath, replacement)
          }
          return nodeStorageRuntime.open(path, flags)
        },
        readFile: async (path) => {
          const content = await nodeStorageRuntime.readFile(path)
          if (path === lockPath && !handedOff) {
            handedOff = true
            unlinkSync(lockPath)
            writeFileSync(lockPath, replacement)
          }
          return content
        },
      }

      // when
      const result = await acquireWorkflowWriteLock({ run_directory: directory, timeout_ms: 50 }, runtime)

      // then
      expect(result).toMatchObject({ kind: "error", error_code: "STORAGE_BUSY" })
      expect(readFileSync(lockPath, "utf8")).toBe(replacement)
      expect(existsSync(stalePath)).toBe(false)
    })

    test("failed cleanup preserves a replacement at the opened temp pathname", async () => {
      // given
      const state = createStoredWorkflowState("temp-cleanup-race", 0)
      const replacement = "UNOWNED_REPLACEMENT"
      let openedTemp = ""
      const runtime: StorageRuntime = {
        ...nodeStorageRuntime,
        open: async (path, flags) => {
          const handle = await nodeStorageRuntime.open(path, flags)
          if (flags !== "wx" || !basename(path).startsWith(".tmp-")) return handle
          openedTemp = path
          return {
            readFile: async () => handle.readFile(),
            identity: async () => handle.identity(),
            writeFile: async (content) => handle.writeFile(content),
            sync: async () => {
              unlinkSync(path)
              writeFileSync(path, replacement, "utf8")
              throw Object.assign(new Error("Injected sync failure"), { code: "EIO" })
            },
            close: async () => handle.close(),
          }
        },
      }

      // when
      const result = await writeImmutableWorkflowRevision({ run_directory: directory, revision: 0, state }, runtime)

      // then
      expect(result).toMatchObject({ kind: "error", error_code: "STORAGE_WRITE_FAILED" })
      expect(readFileSync(openedTemp, "utf8")).toBe(replacement)
    })
  })
}
