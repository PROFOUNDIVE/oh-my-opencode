import type { WorkflowStateV1 } from "../state"
import { renderApplicableAmendments } from "./amendment-state"
import { rejected, transitioned } from "./result"
import { commitAttemptReceipt } from "./stage-record"
import { checkpointApplies, continuedState } from "./stage-continuation"
import type { TransitionResult } from "./types"

type RunningState = Extract<WorkflowStateV1, { readonly status: "RUNNING" }>
type CompletedAttempt = Extract<WorkflowStateV1["dispatch_attempts"][number], { readonly phase: "COMPLETED" }>

export function commitReviewStage(
  state: RunningState,
  input: { readonly attempt: CompletedAttempt; readonly revision: number },
): TransitionResult {
  if (input.attempt.receipt.kind !== "REVIEW" || state.next_stage !== "REVIEW") {
    return rejected(state, "ILLEGAL_TRANSITION", "Review receipt does not match the active stage")
  }
  const currentReview = input.attempt.receipt.review
  if (currentReview.round !== state.review_round) {
    return rejected(state, "ILLEGAL_TRANSITION", "Review receipt round does not match workflow review round")
  }
  const completed = state.completed_review_rounds + 1
  const passes = currentReview.verdict === "PASS" ? state.consecutive_passes + 1 : 0
  const qualifies = currentReview.verdict === "PASS"
    && completed >= state.profile_snapshot.min_review_rounds
    && passes >= state.profile_snapshot.required_consecutive_passes
  const terminalStatus = qualifies ? "PASSED" : completed >= state.profile_snapshot.max_review_rounds ? "EXHAUSTED" : null
  const history = commitAttemptReceipt(state, {
    attempt: input.attempt,
    outcome: terminalStatus || currentReview.verdict !== "INCONCLUSIVE" && !checkpointApplies(state, "REVIEW")
      ? "COMPLETED"
      : "AWAITING_HUMAN",
    revision: input.revision,
  })
  const shared = {
    ...state,
    ...history,
    state_revision: input.revision,
    review_round: terminalStatus ? state.review_round : state.review_round + 1,
    completed_review_rounds: completed,
    consecutive_passes: passes,
    latest_review: currentReview,
    review_history: [...state.review_history, currentReview],
    legacy_projection: state.legacy_projection.kind === "solve_only" && input.attempt.receipt.legacy_metadata !== undefined
      ? { ...state.legacy_projection, review_metadata: input.attempt.receipt.legacy_metadata }
      : state.legacy_projection,
    amendments: consumeNextReviewAmendments(state, input.revision),
  }
  if (terminalStatus) {
    return transitioned({
      ...shared,
      status: terminalStatus,
      next_stage: null,
      awaiting_reason: null,
      abort_requested: false,
      abort_reason: null,
      blocked_reason: null,
      intervention_satisfied: false,
    })
  }
  switch (currentReview.verdict) {
    case "PASS":
      return transitioned({ ...shared, ...continuedState(state, "REVIEW") })
    case "REVISE":
      return transitioned({ ...shared, ...continuedState(state, "REVISE") })
    case "INCONCLUSIVE":
      return transitioned({
        ...shared,
        status: "AWAITING_HUMAN",
        next_stage: "REVIEW",
        awaiting_reason: "INCONCLUSIVE",
        abort_requested: false,
        abort_reason: null,
        blocked_reason: null,
        intervention_satisfied: false,
      })
    default:
      return assertNever(currentReview.verdict)
  }
}

function consumeNextReviewAmendments(state: RunningState, revision: number): WorkflowStateV1["amendments"] {
  const consumed = renderApplicableAmendments(state, "REVIEW")
    .filter((amendment) => amendment.scope === "next_review")
    .map((amendment) => ({
      event_type: "CONSUMED" as const,
      amendment_id: amendment.amendment_id,
      lifecycle: "ACTIVE" as const,
      state_revision: revision,
    }))
  return [...state.amendments, ...consumed]
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected review verdict: ${String(value)}`)
}
