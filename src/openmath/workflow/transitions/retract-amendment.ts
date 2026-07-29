import type { WorkflowStateV1 } from "../state"
import { getActiveAmendments } from "./amendment-state"
import { rejected, transitioned } from "./result"
import type { TransitionResult, WorkflowTransitionEvent } from "./types"

type RetractEvent = Extract<WorkflowTransitionEvent, { readonly type: "RETRACT_AMENDMENT" }>

export function reduceRetractAmendment(state: WorkflowStateV1, event: RetractEvent): TransitionResult {
  switch (state.status) {
    case "READY":
    case "AWAITING_HUMAN": {
      if (!getActiveAmendments(state).has(event.amendment_id)) {
        return rejected(state, "ILLEGAL_TRANSITION", `Active amendment not found: ${event.amendment_id}`)
      }
      const revision = state.state_revision + 1
      return transitioned({
        ...state,
        state_revision: revision,
        intervention_satisfied: state.status === "AWAITING_HUMAN" && state.awaiting_reason !== "CHECKPOINT"
          ? false
          : state.intervention_satisfied,
        amendments: [...state.amendments, {
          event_type: "RETRACTED",
          amendment_id: event.amendment_id,
          lifecycle: "RETRACTED",
          state_revision: revision,
        }],
      })
    }
    case "RUNNING":
    case "BLOCKED":
    case "PASSED":
    case "EXHAUSTED":
    case "ABORTED":
      return rejected(state, "ILLEGAL_TRANSITION", `Cannot retract an amendment while workflow is ${state.status}`)
    default:
      return assertNever(state)
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected workflow state: ${String(value)}`)
}
