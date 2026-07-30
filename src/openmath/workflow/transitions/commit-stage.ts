import type { WorkflowStateV1 } from "../state"
import { commitReviewStage } from "./commit-review-stage"
import { rejected, transitioned } from "./result"
import { commitAttemptReceipt } from "./stage-record"
import { checkpointApplies, continuedState } from "./stage-continuation"
import type { TransitionResult } from "./types"

type RunningState = Extract<WorkflowStateV1, { readonly status: "RUNNING" }>
type CompletedAttempt = Extract<WorkflowStateV1["dispatch_attempts"][number], { readonly phase: "COMPLETED" }>

export function reduceCommitStageReceipt(state: WorkflowStateV1): TransitionResult {
  if (state.status !== "RUNNING") {
    return rejected(state, "ILLEGAL_TRANSITION", "Stage receipts require a RUNNING workflow")
  }
  const attempt = findCompletedAttempt(state)
  if (!attempt || attempt.stage !== state.next_stage) {
    return rejected(state, "ILLEGAL_TRANSITION", "No completed receipt matches the active stage")
  }
  const revision = state.state_revision + 1
  if (state.abort_requested) return commitAborted(state, attempt, revision)
  switch (attempt.receipt.kind) {
    case "ARTIFACT":
      return commitArtifact(state, attempt, revision)
    case "REVIEW":
      return commitReviewStage(state, { attempt, revision })
    case "ERROR":
      return commitError(state, attempt, revision)
    default:
      return assertNever(attempt.receipt)
  }
}

function commitAborted(state: RunningState, attempt: CompletedAttempt, revision: number): TransitionResult {
  return transitioned({
    ...state,
    ...commitAttemptReceipt(state, { attempt, outcome: "ABORTED", revision }),
    state_revision: revision,
    status: "ABORTED",
    next_stage: null,
    awaiting_reason: null,
    abort_requested: true,
    blocked_reason: null,
  })
}

function commitArtifact(state: RunningState, attempt: CompletedAttempt, revision: number): TransitionResult {
  if (attempt.receipt.kind !== "ARTIFACT" || state.next_stage === "REVIEW") {
    return rejected(state, "ILLEGAL_TRANSITION", "Artifact receipt does not match the active stage")
  }
  return transitioned({
    ...state,
    ...commitAttemptReceipt(state, { attempt, outcome: checkpointApplies(state, state.next_stage) ? "AWAITING_HUMAN" : "COMPLETED", revision }),
    ...continuedState(state, "REVIEW"),
    state_revision: revision,
    artifact: attempt.receipt.artifact,
    artifact_version: attempt.receipt.artifact.version,
  })
}

function commitError(state: RunningState, attempt: CompletedAttempt, revision: number): TransitionResult {
  if (attempt.receipt.kind !== "ERROR") {
    return rejected(state, "ILLEGAL_TRANSITION", "Error commit requires an error receipt")
  }
  const parseFailure = attempt.receipt.error_code === "ADAPTER_OUTPUT_INVALID"
    || attempt.receipt.error_code === "SUBAGENT_FAILED"
      && "legacy_failure" in attempt.receipt
      && attempt.receipt.legacy_failure === "SOLVER_PATCH_FAILED"
      && attempt.stage === "REVISE"
      && attempt.role === "solver-markdown-patch"
      && state.profile_snapshot.name === "legacy-educational-markdown"
      && state.legacy_projection.kind === "solve_only"
  const shared = {
    ...state,
    ...commitAttemptReceipt(state, { attempt, outcome: "AWAITING_HUMAN", revision }),
    state_revision: revision,
    next_stage: state.next_stage,
    abort_requested: false as const,
    abort_reason: null,
    intervention_satisfied: false,
  }
  return parseFailure
    ? transitioned({ ...shared, status: "AWAITING_HUMAN", awaiting_reason: "PARSE_FAILURE", blocked_reason: null })
    : transitioned({ ...shared, status: "BLOCKED", awaiting_reason: null, blocked_reason: attempt.receipt.message })
}

function findCompletedAttempt(state: RunningState): CompletedAttempt | undefined {
  return state.dispatch_attempts.findLast((attempt): attempt is CompletedAttempt => attempt.phase === "COMPLETED")
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected stage receipt value: ${String(value)}`)
}
