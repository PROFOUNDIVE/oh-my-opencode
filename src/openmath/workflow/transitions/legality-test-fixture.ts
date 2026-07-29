import type { WorkflowStateV1 } from "../state"
import type { WorkflowTransitionEvent } from "./types"
import { artifact, review, runningWithReceipt, workflowState } from "./test-fixture"

export type StateFamily =
  | "READY"
  | "RUNNING"
  | "CHECKPOINT"
  | "INCONCLUSIVE_UNSATISFIED"
  | "INCONCLUSIVE_SATISFIED"
  | "PARSE_FAILURE_UNSATISFIED"
  | "PARSE_FAILURE_SATISFIED"
  | "BLOCKED"
  | "PASSED"
  | "EXHAUSTED"
  | "ABORTED"

export type MatrixEvent = "STEP_ONE" | "STEP_CHECKPOINT" | "ADD" | "RETRACT" | "RELOAD" | "ABORT" | "COMMIT"

const ACTIVE_AMENDMENT = {
  event_type: "ADDED" as const,
  amendment_id: "amendment-1",
  kind: "question" as const,
  scope: "all_remaining" as const,
  content: "matrix amendment",
  lifecycle: "ACTIVE" as const,
  state_revision: 1,
}

export function stateForFamily(family: StateFamily): WorkflowStateV1 {
  const base = workflowState({ state_revision: 1, amendments: [ACTIVE_AMENDMENT] })
  switch (family) {
    case "READY":
      return base
    case "RUNNING":
      return runningWithReceipt(base, "SOLVE", { kind: "ARTIFACT", artifact: artifact() })
    case "CHECKPOINT":
      return workflowState({
        ...commonOverrides(),
        status: "AWAITING_HUMAN",
        next_stage: "SOLVE",
        awaiting_reason: "CHECKPOINT",
      })
    case "INCONCLUSIVE_UNSATISFIED":
    case "INCONCLUSIVE_SATISFIED":
      return workflowState({
        ...commonOverrides(),
        status: "AWAITING_HUMAN",
        next_stage: "REVIEW",
        awaiting_reason: "INCONCLUSIVE",
        artifact: artifact(),
        intervention_satisfied: family === "INCONCLUSIVE_SATISFIED",
      })
    case "PARSE_FAILURE_UNSATISFIED":
    case "PARSE_FAILURE_SATISFIED":
      return workflowState({
        ...commonOverrides(),
        status: "AWAITING_HUMAN",
        next_stage: "SOLVE",
        awaiting_reason: "PARSE_FAILURE",
        intervention_satisfied: family === "PARSE_FAILURE_SATISFIED",
      })
    case "BLOCKED":
      return workflowState({ ...commonOverrides(), status: "BLOCKED", next_stage: "SOLVE", blocked_reason: "blocked" })
    case "PASSED": {
      const passingReview = review(1, "PASS")
      return workflowState({
        ...commonOverrides(),
        status: "PASSED",
        next_stage: null,
        artifact: artifact(),
        latest_review: passingReview,
        review_history: [passingReview],
        completed_review_rounds: 1,
        consecutive_passes: 1,
      })
    }
    case "EXHAUSTED":
      return workflowState({ ...commonOverrides(), status: "EXHAUSTED", next_stage: null })
    case "ABORTED":
      return workflowState({ ...commonOverrides(), status: "ABORTED", next_stage: null, abort_requested: true })
    default:
      return assertNever(family)
  }
}

export function eventForMatrix(state: WorkflowStateV1, event: MatrixEvent): WorkflowTransitionEvent {
  switch (event) {
    case "STEP_ONE":
      return { type: "STEP", mode: "one_stage" }
    case "STEP_CHECKPOINT":
      return { type: "STEP", mode: "to_checkpoint" }
    case "ADD":
      return { type: "ADD_AMENDMENT", kind: "required_check", scope: "all_remaining", content: "matrix add" }
    case "RETRACT":
      return { type: "RETRACT_AMENDMENT", amendment_id: "amendment-1" }
    case "RELOAD":
      return { type: "RELOAD", profile_snapshot: state.profile_snapshot }
    case "ABORT":
      return { type: "ABORT", reason: "matrix abort" }
    case "COMMIT":
      return { type: "COMMIT_STAGE_RECEIPT" }
    default:
      return assertNever(event)
  }
}

function commonOverrides() {
  return { state_revision: 1, amendments: [ACTIVE_AMENDMENT] }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected matrix value: ${String(value)}`)
}
