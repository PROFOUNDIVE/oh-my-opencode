import type { WorkflowStateV1 } from "../state"

export function blockWorkflowReconciliation(input: Readonly<{
  readonly state: Extract<WorkflowStateV1, { readonly status: "RUNNING" }>
  readonly attempt: WorkflowStateV1["dispatch_attempts"][number]
  readonly message: string
}>): Extract<WorkflowStateV1, { readonly status: "BLOCKED" }> {
  const revision = input.state.state_revision + 1
  return {
    ...input.state,
    status: "BLOCKED",
    awaiting_reason: null,
    abort_requested: false,
    abort_reason: null,
    blocked_reason: input.message,
    intervention_satisfied: false,
    stage_history: [
      ...input.state.stage_history,
      {
        stage: input.attempt.stage,
        role: input.attempt.role,
        resolved_model: input.attempt.resolved_model,
        review_round: input.attempt.review_round,
        profile_hash: input.attempt.profile_hash,
        prompt_hash: input.attempt.prompt_hash,
        reference_hash: input.attempt.reference_hash,
        artifact_version: input.state.artifact_version,
        state_revision: revision,
        attempt_key: input.attempt.idempotency_key,
        input_hash: input.attempt.artifact_input_hash,
        outcome: "BLOCKED",
        raw_session_id: null,
        raw_output: null,
        output_hash: null,
        parsed_result: null,
        parsed_error: {
          kind: "ERROR",
          error_code: "RECONCILIATION_BLOCKED",
          message: input.message,
        },
        error_code: "RECONCILIATION_BLOCKED",
      },
    ],
  }
}
