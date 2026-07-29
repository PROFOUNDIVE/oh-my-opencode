import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { compareAndSwapWorkflowState } from "./compare-and-swap"
import { nodeStorageRuntime } from "./node-storage-runtime"
import { getWorkflowRunDirectory } from "./run-directory-hash"
import type { StorageRuntime } from "./storage-runtime-contract"
import { getWorkflowRevisionPath } from "./revision-filename"
import { startWorkflowState } from "./start-reservation"
import { createStoredWorkflowState } from "./storage-test-state"
import { releaseWorkflowWriteLock } from "./write-lock"

function advancingRuntime(
  startedAt: number,
  processStatus: StorageRuntime["processStatus"],
  sleeps: number[] = [],
): StorageRuntime {
  let currentTime = startedAt
  return {
    ...nodeStorageRuntime,
    now: () => currentTime,
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds)
      currentTime += milliseconds
    },
    processStatus,
  }
}

export function registerLockFailureCases(): void {
  describe("workflow write lock failures", () => {
    let directory: string

    beforeEach(() => {
      directory = mkdtempSync(join(tmpdir(), "openmath-workflow-lock-"))
    })

    afterEach(() => {
      rmSync(directory, { recursive: true, force: true })
    })

    test("returns STORAGE_BUSY after the ordinary five-second live-lock deadline", async () => {
      // given
      const now = Date.parse("2026-07-29T12:00:00.000Z")
      const state = createStoredWorkflowState("busy-cas", 0)
      await startWorkflowState({ directory, state })
      const runDirectory = getWorkflowRunDirectory(directory, state.run_id)
      const sleeps: number[] = []
      writeFileSync(join(runDirectory, ".write.lock"), JSON.stringify({
        token: "live-owner",
        pid: process.pid,
        started_at: new Date(now).toISOString(),
      }))

      // when
      const result = await compareAndSwapWorkflowState({
        directory,
        run_id: state.run_id,
        expected_state_revision: 0,
        next_state: state,
      }, advancingRuntime(now, () => "live", sleeps))

      // then
      expect(result).toMatchObject({ kind: "error", error_code: "STORAGE_BUSY" })
      expect(new Set(sleeps)).toEqual(new Set([50]))
      expect(sleeps.reduce((total, milliseconds) => total + milliseconds, 0)).toBe(5_000)
    })

    test("uses the thirty-second start deadline and classifies allocated revision zero", async () => {
      // given
      const now = Date.parse("2026-07-29T12:00:00.000Z")
      const state = createStoredWorkflowState("start-deadline", 0)
      const runDirectory = getWorkflowRunDirectory(directory, state.run_id)
      mkdirSync(runDirectory, { recursive: true })
      const lock = { token: "live-owner", pid: process.pid, started_at: new Date(now).toISOString() }
      writeFileSync(join(runDirectory, ".write.lock"), JSON.stringify(lock))
      const sleeps: number[] = []
      const runtime = advancingRuntime(now, () => "live", sleeps)

      // when
      const busy = await startWorkflowState({ directory, state }, runtime)
      writeFileSync(getWorkflowRevisionPath(runDirectory, 0), JSON.stringify(state))
      const exists = await startWorkflowState({ directory, state }, advancingRuntime(now, () => "live"))
      writeFileSync(getWorkflowRevisionPath(runDirectory, 0), "{corrupt")
      const corrupt = await startWorkflowState({ directory, state }, advancingRuntime(now, () => "live"))

      // then
      expect(busy).toMatchObject({ kind: "error", error_code: "STORAGE_BUSY" })
      expect(new Set(sleeps)).toEqual(new Set([50]))
      expect(sleeps.reduce((total, milliseconds) => total + milliseconds, 0)).toBe(30_000)
      expect(exists).toMatchObject({ kind: "error", error_code: "RUN_ALREADY_EXISTS" })
      expect(corrupt).toMatchObject({ kind: "error", error_code: "STORAGE_READ_FAILED" })
    })

    test("renames a dead stale lock once and retries exclusive acquisition", async () => {
      // given
      const now = Date.parse("2026-07-29T12:00:31.000Z")
      const state = createStoredWorkflowState("stale-lock", 0)
      const runDirectory = getWorkflowRunDirectory(directory, state.run_id)
      const deadPid = 2_147_483_647
      mkdirSync(runDirectory, { recursive: true })
      writeFileSync(join(runDirectory, ".write.lock"), JSON.stringify({
        token: "dead-token",
        pid: deadPid,
        started_at: "2026-07-29T12:00:00.000Z",
      }))

      // when
      const processStatus = nodeStorageRuntime.processStatus(deadPid)
      const result = await startWorkflowState({ directory, state }, advancingRuntime(now, nodeStorageRuntime.processStatus))

      // then
      expect(processStatus).toBe("dead")
      expect(result).toMatchObject({ kind: "ok", state: { state_revision: 0 } })
      expect(existsSync(join(runDirectory, ".stale-lock-dead-token"))).toBe(true)
      expect(existsSync(join(runDirectory, ".write.lock"))).toBe(false)
    })

    test("treats a malformed lock as unverifiable until the start deadline", async () => {
      // given
      const now = Date.parse("2026-07-29T12:00:00.000Z")
      const state = createStoredWorkflowState("unverifiable-lock", 0)
      const runDirectory = getWorkflowRunDirectory(directory, state.run_id)
      mkdirSync(runDirectory, { recursive: true })
      writeFileSync(join(runDirectory, ".write.lock"), JSON.stringify({ token: "missing-fields" }))

      // when
      const result = await startWorkflowState({ directory, state }, advancingRuntime(now, () => "unverifiable"))

      // then
      expect(result).toMatchObject({ kind: "error", error_code: "STORAGE_BUSY" })
    })

    test("makes a final exclusive-create attempt when the start deadline is reached", async () => {
      // given
      const startedAt = Date.parse("2026-07-29T12:00:00.000Z")
      let currentTime = startedAt
      const state = createStoredWorkflowState("deadline-release", 0)
      const runDirectory = getWorkflowRunDirectory(directory, state.run_id)
      const lockPath = join(runDirectory, ".write.lock")
      mkdirSync(runDirectory, { recursive: true })
      writeFileSync(lockPath, JSON.stringify({
        token: "deadline-owner",
        pid: process.pid,
        started_at: new Date(startedAt).toISOString(),
      }))
      const runtime: StorageRuntime = {
        ...nodeStorageRuntime,
        now: () => currentTime,
        sleep: async (milliseconds) => {
          currentTime += milliseconds
          if (currentTime === startedAt + 30_000) unlinkSync(lockPath)
        },
      }

      // when
      const result = await startWorkflowState({ directory, state }, runtime)

      // then
      expect(result).toMatchObject({ kind: "ok", state: { state_revision: 0 } })
    })

    test("does not remove a lock whose token differs from the owner token", async () => {
      // given
      const runDirectory = join(directory, "run")
      mkdirSync(runDirectory, { recursive: true })
      const lockPath = join(runDirectory, ".write.lock")
      writeFileSync(lockPath, JSON.stringify({
        token: "replacement-owner",
        pid: process.pid,
        started_at: new Date().toISOString(),
      }))

      // when
      const result = await releaseWorkflowWriteLock({ run_directory: runDirectory, token: "original-owner" })

      // then
      expect(result).toMatchObject({ kind: "ok" })
      expect(JSON.parse(readFileSync(lockPath, "utf8"))).toMatchObject({ token: "replacement-owner" })
    })

    test("fails closed instead of removing an unverifiable owned lock", async () => {
      // given
      const runDirectory = join(directory, "unverifiable-release")
      const lockPath = join(runDirectory, ".write.lock")
      mkdirSync(runDirectory, { recursive: true })
      writeFileSync(lockPath, "{corrupt")

      // when
      const result = await releaseWorkflowWriteLock({ run_directory: runDirectory, token: "owner-token" })

      // then
      expect(result).toMatchObject({ kind: "error", error_code: "STORAGE_WRITE_FAILED" })
      expect(readFileSync(lockPath, "utf8")).toBe("{corrupt")
    })

    test("reports an owned lock unlink failure without claiming release", async () => {
      // given
      const runDirectory = join(directory, "unlink-release")
      const lockPath = join(runDirectory, ".write.lock")
      const token = "owner-token"
      mkdirSync(runDirectory, { recursive: true })
      writeFileSync(lockPath, JSON.stringify({ token, pid: process.pid, started_at: new Date().toISOString() }))
      const runtime: StorageRuntime = {
        ...nodeStorageRuntime,
        unlink: async () => {
          throw Object.assign(new Error("Injected unlink failure"), { code: "EIO" })
        },
      }

      // when
      const result = await releaseWorkflowWriteLock({ run_directory: runDirectory, token }, runtime)

      // then
      expect(result).toMatchObject({ kind: "error", error_code: "STORAGE_WRITE_FAILED" })
      expect(existsSync(lockPath)).toBe(true)
    })
  })
}
