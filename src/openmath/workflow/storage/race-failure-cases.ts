import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { readWorkflowState } from "./reader"
import type { StorageRaceRequest } from "./race-request"
import { runStorageRace } from "./race-test-driver"
import { getWorkflowRevisionPath } from "./revision-filename"
import { getWorkflowRunDirectory } from "./run-directory-hash"
import { startWorkflowState } from "./start-reservation"
import { createStoredWorkflowState } from "./storage-test-state"

export function registerRaceFailureCases(): void {
  describe("cross-process workflow storage races", () => {
    let directory: string

    beforeEach(() => {
      directory = mkdtempSync(join(tmpdir(), "openmath-workflow-race-"))
    })

    afterEach(() => {
      rmSync(directory, { recursive: true, force: true })
    })

    test("allows one simultaneous start and rejects the other as an existing run", async () => {
      // given
      const state = createStoredWorkflowState("start-race", 0)
      const request = { operation: "start", directory, state } satisfies StorageRaceRequest

      // when
      const outputs = await runStorageRace(directory, [request, request])

      // then
      expect(outputs.map((output) => output.kind).sort()).toEqual(["error", "ok"])
      expect(outputs.find((output) => output.kind === "error")?.error_code).toBe("RUN_ALREADY_EXISTS")
      expect((await readWorkflowState(directory, state.run_id))).toMatchObject({
        kind: "ok",
        state: { state_revision: 0 },
      })
      const runDirectory = getWorkflowRunDirectory(directory, state.run_id)
      expect(readdirSync(runDirectory).filter((name) => name.startsWith(".tmp-"))).toEqual([])
    })

    test("allows one two-process CAS winner and reports the loser as stale", async () => {
      // given
      const runId = "cas-race"
      const initial = createStoredWorkflowState(runId, 0)
      await startWorkflowState({ directory, state: initial })
      const runDirectory = getWorkflowRunDirectory(directory, runId)
      const revisionZero = getWorkflowRevisionPath(runDirectory, 0)
      const priorBytes = readFileSync(revisionZero, "utf8")
      const requests: StorageRaceRequest[] = [true, false].map((interventionSatisfied) => ({
        operation: "cas",
        directory,
        run_id: runId,
        expected_state_revision: 0,
        next_state: { ...initial, intervention_satisfied: interventionSatisfied },
      }))

      // when
      const outputs = await runStorageRace(directory, requests)

      // then
      expect(outputs.map((output) => output.kind).sort()).toEqual(["error", "ok"])
      expect(outputs.find((output) => output.kind === "error")).toMatchObject({
        error_code: "STALE_STATE_REVISION",
        current_state_revision: 1,
      })
      expect(await readWorkflowState(directory, runId)).toMatchObject({ kind: "ok", state: { state_revision: 1 } })
      expect(readFileSync(revisionZero, "utf8")).toBe(priorBytes)
      expect(readdirSync(runDirectory).filter((name) => name.startsWith(".tmp-"))).toEqual([])
    })
  })
}
