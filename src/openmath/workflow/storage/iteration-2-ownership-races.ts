import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"

import { writeImmutableWorkflowRevision } from "./atomic-writer"
import { nodeStorageRuntime } from "./node-storage-runtime"
import { getWorkflowRevisionPath } from "./revision-filename"
import type { StorageFileHandle, StorageRuntime } from "./storage-runtime-contract"
import { createStoredWorkflowState } from "./storage-test-state"
import { acquireWorkflowWriteLock, releaseWorkflowWriteLock } from "./write-lock"

function lockRecord(token: string, pid: number, startedAt: string): string {
  return JSON.stringify({ token, pid, started_at: startedAt })
}

export function registerIterationTwoOwnershipRaces(): void {
  describe("workflow storage iteration-two ownership races", () => {
    let directory: string

    beforeEach(() => {
      directory = mkdtempSync(join(tmpdir(), "openmath-workflow-iteration-two-"))
    })
    afterEach(() => rmSync(directory, { recursive: true, force: true }))

    test("release never strands a replacement when a third contender arrives", async () => {
      const lockPath = join(directory, ".write.lock")
      const replacement = lockRecord("replacement-owner", process.pid, new Date().toISOString())
      const contender = lockRecord("new-contender", process.pid, new Date().toISOString())
      writeFileSync(lockPath, lockRecord("original-owner", process.pid, new Date().toISOString()))
      const runtime: StorageRuntime = {
        ...nodeStorageRuntime,
        open: async (path, flags) => {
          if (path === lockPath && flags === "r") {
            unlinkSync(lockPath)
            writeFileSync(lockPath, replacement)
          }
          return nodeStorageRuntime.open(path, flags)
        },
        rename: async (source, destination) => {
          if (source === lockPath) {
            unlinkSync(lockPath)
            writeFileSync(lockPath, replacement)
            await nodeStorageRuntime.rename(source, destination)
            writeFileSync(lockPath, contender, { flag: "wx" })
            return
          }
          await nodeStorageRuntime.rename(source, destination)
        },
      }

      const result = await releaseWorkflowWriteLock({ run_directory: directory, token: "original-owner" }, runtime)

      expect(result).toMatchObject({ kind: "ok" })
      expect(readFileSync(lockPath, "utf8")).toBe(replacement)
      expect(readdirSync(directory).some((name) => name.startsWith(".lock-release-"))).toBe(false)
    })

    test("stale handling never strands a live replacement when a third contender arrives", async () => {
      const lockPath = join(directory, ".write.lock")
      const stale = lockRecord("stale-owner", 2_147_483_647, "2026-07-29T12:00:00.000Z")
      const replacement = lockRecord("live-replacement", process.pid, "2026-07-29T12:00:31.000Z")
      const contender = lockRecord("new-contender", process.pid, "2026-07-29T12:00:31.000Z")
      writeFileSync(lockPath, stale)
      let now = Date.parse("2026-07-29T12:00:31.000Z")
      let inspected = false
      const runtime: StorageRuntime = {
        ...nodeStorageRuntime,
        now: () => now,
        sleep: async (milliseconds) => { now += milliseconds },
        readFile: async (path) => {
          const content = await nodeStorageRuntime.readFile(path)
          if (path === lockPath && !inspected) {
            inspected = true
            unlinkSync(lockPath)
            writeFileSync(lockPath, replacement)
          }
          return content
        },
        open: async (path, flags) => {
          if (path === lockPath && flags === "r" && !inspected) {
            inspected = true
            unlinkSync(lockPath)
            writeFileSync(lockPath, replacement)
          }
          return nodeStorageRuntime.open(path, flags)
        },
        rename: async (source, destination) => {
          await nodeStorageRuntime.rename(source, destination)
          if (source === lockPath) writeFileSync(lockPath, contender, { flag: "wx" })
        },
      }

      const result = await acquireWorkflowWriteLock({ run_directory: directory, timeout_ms: 50 }, runtime)

      expect(result).toMatchObject({ kind: "error", error_code: "STORAGE_BUSY" })
      expect(readFileSync(lockPath, "utf8")).toBe(replacement)
      expect(readdirSync(directory).some((name) => name.startsWith(".lock-recovery-"))).toBe(false)
    })

    for (const writeFails of [true, false]) {
      test(`pre-anchor replacement is preserved when write failure is ${writeFails}`, async () => {
        const state = createStoredWorkflowState(`pre-anchor-${writeFails}`, 0)
        const revisionPath = getWorkflowRevisionPath(directory, 0)
        const replacement = "UNOWNED_PRE_ANCHOR"
        let tempPath = ""
        let replaced = false
        const runtime: StorageRuntime = {
          ...nodeStorageRuntime,
          open: async (path, flags) => {
            const handle = await nodeStorageRuntime.open(path, flags)
            if (flags !== "wx" || !basename(path).startsWith(".tmp-")) return handle
            tempPath = path
            return writeFails ? failingWriteHandle(handle) : handle
          },
          link: async (source, destination) => {
            if (!replaced && source === tempPath && destination.endsWith(".owner")) {
              replaced = true
              unlinkSync(source)
              writeFileSync(source, replacement)
            }
            await nodeStorageRuntime.link(source, destination)
          },
        }

        const result = await writeImmutableWorkflowRevision({ run_directory: directory, revision: 0, state }, runtime)

        expect(result).toMatchObject({ kind: "error", error_code: "STORAGE_WRITE_FAILED" })
        expect(readFileSync(tempPath, "utf8")).toBe(replacement)
        expect(existsSync(revisionPath)).toBe(false)
      })
    }
  })
}

function failingWriteHandle(handle: StorageFileHandle): StorageFileHandle {
  return {
    readFile: async () => handle.readFile(),
    identity: async () => handle.identity(),
    writeFile: async () => { throw Object.assign(new Error("Injected write failure"), { code: "EIO" }) },
    sync: async () => handle.sync(),
    close: async () => handle.close(),
  }
}
