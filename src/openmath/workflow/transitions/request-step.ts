import type { WorkflowStateV1 } from "../state"
import { rejected, transitioned } from "./result"
import type { TransitionResult, WorkflowTransitionEvent } from "./types"

type StepEvent = Extract<WorkflowTransitionEvent, { readonly type: "STEP" }>

export function reduceStep(state: WorkflowStateV1, event: StepEvent): TransitionResult {
  switch (state.status) {
    case "READY":
      return dispatch(state)
    case "RUNNING":
      return transitioned(state, "reconcile")
    case "BLOCKED":
      return event.mode === "one_stage"
        ? transitioned(state, "reconcile")
        : rejected(state, "ILLEGAL_TRANSITION", "Blocked workflows support one-stage reconciliation only")
    case "AWAITING_HUMAN": {
      const reason = state.awaiting_reason
      switch (reason) {
        case "CHECKPOINT":
          return dispatch(state)
        case "INCONCLUSIVE":
        case "PARSE_FAILURE":
          return state.intervention_satisfied
            ? dispatch(state)
            : rejected(state, "ILLEGAL_TRANSITION", "Workflow requires an applicable intervention before stepping")
        default:
          return assertNever(reason)
      }
    }
    case "PASSED":
    case "EXHAUSTED":
    case "ABORTED":
      return rejected(state, "ILLEGAL_TRANSITION", `Cannot step terminal workflow ${state.status}`)
    default:
      return assertNever(state)
  }
}

function dispatch(state: Extract<WorkflowStateV1, { readonly next_stage: string }>): TransitionResult {
  return transitioned({
    ...state,
    state_revision: state.state_revision + 1,
    status: "RUNNING",
    awaiting_reason: null,
    abort_requested: false,
    abort_reason: null,
    blocked_reason: null,
    intervention_satisfied: false,
  }, "dispatch")
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected transition value: ${String(value)}`)
}
