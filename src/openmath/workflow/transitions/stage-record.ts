import type { WorkflowStateV1 } from "../state"

type CompletedAttempt = Extract<WorkflowStateV1["dispatch_attempts"][number], { readonly phase: "COMPLETED" }>
type StageOutcome = "COMPLETED" | "AWAITING_HUMAN" | "ABORTED"

export function commitAttemptReceipt(
  state: Extract<WorkflowStateV1, { readonly status: "RUNNING" }>,
  input: { readonly attempt: CompletedAttempt; readonly outcome: StageOutcome; readonly revision: number },
): Pick<WorkflowStateV1, "dispatch_attempts" | "stage_history"> {
  const receipt = input.attempt.receipt
  const parsedResult = receipt.kind === "ERROR" ? null : receipt
  const parsedError = receipt.kind === "ERROR" ? receipt : null
  const artifactVersion = receipt.kind === "ARTIFACT" ? receipt.artifact.version : state.artifact_version
  const record: WorkflowStateV1["stage_history"][number] = {
    stage: input.attempt.stage,
    role: input.attempt.role,
    resolved_model: input.attempt.resolved_model,
    review_round: input.attempt.review_round,
    profile_hash: input.attempt.profile_hash,
    prompt_hash: input.attempt.prompt_hash,
    reference_hash: input.attempt.reference_hash,
    artifact_version: artifactVersion,
    state_revision: input.revision,
    attempt_key: input.attempt.idempotency_key,
    input_hash: input.attempt.artifact_input_hash,
    outcome: input.outcome,
    raw_session_id: input.attempt.child_session_id,
    raw_output: input.attempt.raw_output,
    output_hash: input.attempt.output_hash,
    parsed_result: parsedResult,
    parsed_error: parsedError,
    error_code: parsedError?.error_code ?? null,
  }
  return {
    dispatch_attempts: state.dispatch_attempts.map((attempt) => (
      attempt === input.attempt ? { ...input.attempt, phase: "COMMITTED" } : attempt
    )),
    stage_history: [...state.stage_history, record],
  }
}
