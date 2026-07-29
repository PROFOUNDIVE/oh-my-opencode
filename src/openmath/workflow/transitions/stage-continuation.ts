import type { WorkflowStateV1 } from "../state"

type RunningState = Extract<WorkflowStateV1, { readonly status: "RUNNING" }>
export type ContinuationFields =
  | {
      readonly status: "READY"
      readonly next_stage: "REVIEW" | "REVISE"
      readonly awaiting_reason: null
      readonly abort_requested: false
      readonly abort_reason: null
      readonly blocked_reason: null
      readonly intervention_satisfied: false
    }
  | {
      readonly status: "AWAITING_HUMAN"
      readonly next_stage: "REVIEW" | "REVISE"
      readonly awaiting_reason: "CHECKPOINT"
      readonly abort_requested: false
      readonly abort_reason: null
      readonly blocked_reason: null
      readonly intervention_satisfied: false
    }

export function continuedState(state: RunningState, nextStage: "REVIEW" | "REVISE"): ContinuationFields {
  if (checkpointApplies(state, state.next_stage)) {
    return {
      status: "AWAITING_HUMAN",
      next_stage: nextStage,
      awaiting_reason: "CHECKPOINT",
      abort_requested: false,
      abort_reason: null,
      blocked_reason: null,
      intervention_satisfied: false,
    }
  }
  return {
    status: "READY",
    next_stage: nextStage,
    awaiting_reason: null,
    abort_requested: false,
    abort_reason: null,
    blocked_reason: null,
    intervention_satisfied: false,
  }
}

export function checkpointApplies(state: RunningState, stage: "SOLVE" | "REVIEW" | "REVISE"): boolean {
  switch (state.profile_snapshot.checkpoint) {
    case "none":
      return false
    case "after_solve":
      return stage === "SOLVE"
    case "after_review":
      return stage === "REVIEW"
    case "every_stage":
      return true
    default:
      return assertNever(state.profile_snapshot.checkpoint)
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected checkpoint policy: ${String(value)}`)
}
