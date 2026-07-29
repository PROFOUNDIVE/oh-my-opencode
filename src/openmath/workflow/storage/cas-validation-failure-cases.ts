import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { WorkflowStateV1Schema } from "../state"
import { createWorkflowStateFixture } from "../state/test-fixture"
import { compareAndSwapWorkflowState } from "./compare-and-swap"
import { getWorkflowRunDirectory } from "./run-directory-hash"
import { getWorkflowRevisionPath } from "./revision-filename"
import { startWorkflowState } from "./start-reservation"
import { createStoredWorkflowState } from "./storage-test-state"

export function registerCasValidationFailureCases(): void {
  describe("workflow CAS result validation", () => {
    let directory: string

    beforeEach(() => {
      directory = mkdtempSync(join(tmpdir(), "openmath-workflow-cas-validation-"))
    })

    afterEach(() => {
      rmSync(directory, { recursive: true, force: true })
    })

    test("rejects a resulting state that is invalid at the allocated revision", async () => {
      // given
      const runId = "invalid-result"
      const initial = createStoredWorkflowState(runId, 0)
      await startWorkflowState({ directory, state: initial })
      const futureAmendmentState = WorkflowStateV1Schema.parse({ ...createWorkflowStateFixture(), run_id: runId })

      // when
      const result = await compareAndSwapWorkflowState({
        directory,
        run_id: runId,
        expected_state_revision: 0,
        next_state: futureAmendmentState,
      })

      // then
      expect(result).toMatchObject({ kind: "error", error_code: "STORAGE_WRITE_FAILED" })
      const runDirectory = getWorkflowRunDirectory(directory, runId)
      expect(existsSync(getWorkflowRevisionPath(runDirectory, 1))).toBe(false)
    })

    test("rejects a next state for a different requested run ID", async () => {
      // given
      const runId = "cas-requested-run"
      const initial = createStoredWorkflowState(runId, 0)
      await startWorkflowState({ directory, state: initial })

      // when
      const result = await compareAndSwapWorkflowState({
        directory,
        run_id: runId,
        expected_state_revision: 0,
        next_state: createStoredWorkflowState("other-run", 0),
      })

      // then
      expect(result).toMatchObject({ kind: "error", error_code: "STORAGE_WRITE_FAILED" })
      const runDirectory = getWorkflowRunDirectory(directory, runId)
      expect(existsSync(getWorkflowRevisionPath(runDirectory, 1))).toBe(false)
    })
  })
}
