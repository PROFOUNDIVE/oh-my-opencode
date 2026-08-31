import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { nodeStorageRuntime } from "./node-storage-runtime"
import { getWorkflowRunDirectory } from "./run-directory-hash"
import type { StorageRuntime } from "./storage-runtime-contract"
import { startWorkflowState } from "./start-reservation"
import { createStoredWorkflowState } from "./storage-test-state"

export function registerStaleLockRecoveryIntegrationCases(): void {
  describe("workflow stale-lock recovery", () => {
    let directory: string

    beforeEach(() => {
      directory = mkdtempSync(join(tmpdir(), "openmath-stale-recovery-"))
    })

    afterEach(() => {
      rmSync(directory, { recursive: true, force: true })
    })

    test("retires a dead stale lock and retries exclusive acquisition", async () => {
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
      const runtime: StorageRuntime = {
        ...nodeStorageRuntime,
        now: () => now,
      }

      // when
      const processStatus = nodeStorageRuntime.processStatus(deadPid)
      const result = await startWorkflowState({ directory, state }, runtime)

      // then
      expect(processStatus).toBe("dead")
      expect(result).toMatchObject({ kind: "ok", state: { state_revision: 0 } })
      expect(existsSync(join(runDirectory, ".stale-lock-dead-token"))).toBe(false)
      expect(existsSync(join(runDirectory, ".write.lock"))).toBe(false)
    })
  })
}
