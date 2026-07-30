import { compareAndSwapWorkflowState } from "../../openmath/workflow/storage"
import { WorkflowStateV1Schema, type WorkflowStateV1 } from "../../openmath/workflow/state"
import { shouldConsumeReviewBudgetForMarkdownError } from "./markdown-round-error-policy"
import { nextMarkdownPatchFailureState, shouldUseMarkdownPatch } from "./markdown-round-policy"
import { shouldRegenerateMarkdownArtifacts } from "./markdown-round/regenerate-markdown-artifacts"

export async function recoverLegacyParseFailure(
  directory: string,
  state: WorkflowStateV1,
): Promise<WorkflowStateV1> {
  if (state.status !== "AWAITING_HUMAN" || state.awaiting_reason !== "PARSE_FAILURE") return state
  const attempt = state.dispatch_attempts.findLast((candidate) => candidate.phase === "COMMITTED")
  if (attempt?.phase !== "COMMITTED" || attempt.receipt.kind !== "ERROR") return state
  const identity = patchErrorIdentity(attempt.stage, attempt.receipt)
  if (attempt.stage !== "REVISE" && !shouldConsumeReviewBudgetForMarkdownError(identity.error_code)) return state
  const completed = state.completed_review_rounds + 1
  const exhausted = completed >= state.profile_snapshot.max_review_rounds
  const fallback = state.legacy_projection.kind === "solve_only" ? state.legacy_projection.markdown_fallback : null
  const previousFailureState = fallback === null ? undefined : {
    consecutive_failures: fallback.consecutive_failures,
    ...(fallback.last_error_code === null ? {} : { last_error_code: fallback.last_error_code }),
    ...(fallback.last_section_id === null ? {} : { last_section_id: fallback.last_section_id }),
  }
  const nextFailureState = attempt.stage === "REVISE"
    ? nextMarkdownPatchFailureState(previousFailureState, {
        error_code: identity.error_code,
        ...(identity.section_id === null ? {} : { section_id: identity.section_id }),
      })
    : previousFailureState
  const consecutive = nextFailureState?.consecutive_failures ?? 0
  const nextFallback = fallback === null ? null : {
    ...fallback,
    consecutive_failures: consecutive,
    last_error_code: attempt.stage === "REVISE" ? identity.error_code : fallback.last_error_code,
    last_section_id: attempt.stage === "REVISE" ? identity.section_id : fallback.last_section_id,
    regenerate_next: attempt.stage === "REVISE" && shouldRegenerateMarkdownArtifacts(
      state.review_round + 1,
      shouldUseMarkdownPatch({
        round: state.review_round + 1,
        hasBaseArtifacts: state.artifact !== null,
        previousFailureState: nextFailureState,
        maxConsecutivePatchFailures: fallback.max_consecutive_patch_failures,
      }),
    ),
    sub_attempt_history: attempt.stage === "REVISE"
      ? [...fallback.sub_attempt_history, {
          kind: "patch" as const,
          review_round: state.review_round,
          outcome: "FAILED" as const,
          error_code: identity.error_code,
          section_id: identity.section_id,
        }]
      : fallback.sub_attempt_history,
  }
  const nextState = WorkflowStateV1Schema.parse({
    ...state,
    status: exhausted ? "EXHAUSTED" as const : "READY" as const,
    next_stage: exhausted ? null : nextStageAfterFailure(state, attempt.stage),
    awaiting_reason: null,
    abort_requested: false as const,
    abort_reason: null,
    blocked_reason: null,
    intervention_satisfied: false,
    completed_review_rounds: completed,
    review_round: exhausted ? state.review_round : state.review_round + 1,
    legacy_projection: state.legacy_projection.kind === "solve_only"
      ? { ...state.legacy_projection, markdown_fallback: nextFallback }
      : state.legacy_projection,
  })
  const result = await compareAndSwapWorkflowState({
    directory,
    run_id: state.run_id,
    expected_state_revision: state.state_revision,
    next_state: nextState,
  })
  if (result.kind === "error") throw new Error(result.message)
  return result.state
}

function nextStageAfterFailure(state: WorkflowStateV1, stage: "SOLVE" | "REVIEW" | "REVISE") {
  if (stage === "SOLVE") return "SOLVE" as const
  if (stage === "REVIEW") return state.artifact === null ? "SOLVE" as const : "REVISE" as const
  return "REVISE" as const
}

function patchErrorIdentity(
  stage: "SOLVE" | "REVIEW" | "REVISE",
  receipt: Extract<WorkflowStateV1["dispatch_attempts"][number], { readonly phase: "COMMITTED" }>["receipt"],
): {
  readonly error_code: string
  readonly section_id: string | null
} {
  if (receipt.kind !== "ERROR") return { error_code: "PATCH_OUTPUT_INVALID", section_id: null }
  if (stage === "REVISE" && "legacy_failure" in receipt) {
    return { error_code: receipt.legacy_failure, section_id: null }
  }
  if (!("adapter_error" in receipt)) {
    return { error_code: receipt.error_code, section_id: null }
  }
  if (receipt.adapter_error.code === "PATCH_APPLY_FAILED") return receipt.adapter_error.patch_failure
  if (stage === "SOLVE") return { error_code: "ARTIFACTS_PARSE_ERROR", section_id: null }
  if (stage === "REVIEW") return { error_code: "REVIEWER_OUTPUT_INVALID", section_id: null }
  return { error_code: "PATCH_OUTPUT_INVALID", section_id: null }
}
