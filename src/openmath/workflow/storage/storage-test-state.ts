import { WorkflowStateV1Schema, type WorkflowStateV1 } from "../state"
import { createWorkflowStateFixture } from "../state/test-fixture"

export function createStoredWorkflowState(runId: string, revision: number): WorkflowStateV1 {
  return WorkflowStateV1Schema.parse({
    ...createWorkflowStateFixture(),
    run_id: runId,
    state_revision: revision,
    amendments: [],
    stage_history: [],
    dispatch_attempts: [],
  })
}
