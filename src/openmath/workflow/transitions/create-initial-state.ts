import { WorkflowStateV1Schema, type WorkflowStateV1 } from "../state"

export type InitialWorkflowStateInput = {
  readonly run_id: string
  readonly parent_session_id: string
  readonly profile_snapshot: WorkflowStateV1["profile_snapshot"]
  readonly reference_snapshot: WorkflowStateV1["reference_snapshot"]
  readonly artifact?: NonNullable<WorkflowStateV1["artifact"]>
}

export function createInitialWorkflowState(input: InitialWorkflowStateInput): WorkflowStateV1 {
  return WorkflowStateV1Schema.parse({
    schema_version: 1,
    run_id: input.run_id,
    state_revision: 0,
    parent_session_id: input.parent_session_id,
    status: "READY",
    next_stage: input.artifact ? "REVIEW" : "SOLVE",
    awaiting_reason: null,
    abort_requested: false,
    abort_reason: null,
    blocked_reason: null,
    intervention_satisfied: false,
    review_round: 1,
    completed_review_rounds: 0,
    consecutive_passes: 0,
    artifact_version: input.artifact?.version ?? 1,
    profile_snapshot: input.profile_snapshot,
    reference_snapshot: input.reference_snapshot,
    artifact: input.artifact ?? null,
    latest_review: null,
    review_history: [],
    amendments: [],
    stage_history: [],
    dispatch_attempts: [],
    legacy_projection: { kind: "none" },
    legacy_source_hash: null,
  })
}
