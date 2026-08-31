import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { nodeStorageRuntime } from "./node-storage-runtime"
import type { StorageRuntime } from "./storage-runtime-contract"
import { acquireWorkflowWriteLock } from "./write-lock"

export function registerStaleArchiveCleanupCases(): void {
  describe("stale archive cleanup", () => {
    let directory: string
    const lockPath = () => join(directory, ".write.lock")
    const stalePath = () => join(directory, ".stale-lock-stale-owner")
    const stale = JSON.stringify({ token: "stale-owner", pid: 2_147_483_647, started_at: "2026-07-29T12:00:00.000Z" })

    beforeEach(() => {
      directory = mkdtempSync(join(tmpdir(), "openmath-stale-cleanup-"))
      writeFileSync(lockPath(), stale)
    })
    afterEach(() => rmSync(directory, { recursive: true, force: true }))

    test("removes its archive when post-link identity validation fails", async () => {
      const runtime: StorageRuntime = {
        ...nodeStorageRuntime,
        now: () => Date.parse("2026-07-29T12:00:31.000Z"),
        sameIdentity: async (path, identity) => path === stalePath() ? false : nodeStorageRuntime.sameIdentity(path, identity),
      }

      const result = await acquireWorkflowWriteLock({ run_directory: directory, timeout_ms: 0 }, runtime)

      expect(result).toMatchObject({ kind: "error", error_code: "STORAGE_BUSY" })
      expect(readFileSync(lockPath(), "utf8")).toBe(stale)
      expect(existsSync(stalePath())).toBe(false)
    })

    test("removes its archive when public-lock unlink fails", async () => {
      const runtime: StorageRuntime = {
        ...nodeStorageRuntime,
        now: () => Date.parse("2026-07-29T12:00:31.000Z"),
        unlink: async (path) => {
          if (path === lockPath()) throw Object.assign(new Error("Injected unlink failure"), { code: "EIO" })
          await nodeStorageRuntime.unlink(path)
        },
      }

      const result = await acquireWorkflowWriteLock({ run_directory: directory, timeout_ms: 0 }, runtime)

      expect(result).toMatchObject({ kind: "error", error_code: "STORAGE_BUSY" })
      expect(readFileSync(lockPath(), "utf8")).toBe(stale)
      expect(existsSync(stalePath())).toBe(false)
    })

    test("removes its archive after successful stale-owner recovery", async () => {
      // given
      const runtime: StorageRuntime = {
        ...nodeStorageRuntime,
        now: () => Date.parse("2026-07-29T12:00:31.000Z"),
        processStatus: () => "dead",
        token: () => "replacement-owner",
      }

      // when
      const result = await acquireWorkflowWriteLock({ run_directory: directory, timeout_ms: 0 }, runtime)

      // then
      expect(result).toEqual({ kind: "acquired", token: "replacement-owner" })
      expect(existsSync(stalePath())).toBe(false)
    })
  })
}
