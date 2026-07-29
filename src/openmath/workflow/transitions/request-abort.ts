import type { WorkflowStateV1 } from "../state"
import { rejected, transitioned } from "./result"
import type { TransitionResult, WorkflowTransitionEvent } from "./types"

type AbortEvent = Extract<WorkflowTransitionEvent, { readonly type: "ABORT" }>

export function reduceAbort(state: WorkflowStateV1, event: AbortEvent): TransitionResult {
  switch (state.status) {
    case "RUNNING":
      return transitioned({
        ...state,
        state_revision: state.state_revision + 1,
        abort_requested: true,
        abort_reason: event.reason ?? null,
      })
    case "READY":
    case "AWAITING_HUMAN":
    case "BLOCKED":
      return transitioned({
        ...state,
        state_revision: state.state_revision + 1,
        status: "ABORTED",
        next_stage: null,
        awaiting_reason: null,
        abort_requested: true,
        abort_reason: event.reason ?? null,
        blocked_reason: null,
      })
    case "PASSED":
    case "EXHAUSTED":
    case "ABORTED":
      return rejected(state, "ILLEGAL_TRANSITION", `Cannot abort terminal workflow ${state.status}`)
    default:
      return assertNever(state)
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected workflow state: ${String(value)}`)
}
