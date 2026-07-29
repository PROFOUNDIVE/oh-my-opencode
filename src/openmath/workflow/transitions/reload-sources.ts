import type { WorkflowStateV1 } from "../state"
import { rejected, transitioned } from "./result"
import type { TransitionResult, WorkflowTransitionEvent } from "./types"

type ReloadEvent = Extract<WorkflowTransitionEvent, { readonly type: "RELOAD" }>

export function reduceReloadSources(state: WorkflowStateV1, event: ReloadEvent): TransitionResult {
  switch (state.status) {
    case "READY":
    case "AWAITING_HUMAN":
      return reloadSources(state, event)
    case "RUNNING":
    case "BLOCKED":
    case "PASSED":
    case "EXHAUSTED":
    case "ABORTED":
      return rejected(state, "ILLEGAL_TRANSITION", `Cannot reload sources while workflow is ${state.status}`)
    default:
      return assertNever(state)
  }
}

function reloadSources(
  state: Extract<WorkflowStateV1, { readonly status: "READY" | "AWAITING_HUMAN" }>,
  event: ReloadEvent,
): TransitionResult {
  if (!event.profile_snapshot && !event.reference_snapshot) {
    return rejected(state, "VALIDATION_ERROR", "Reload requires a prompt or reference snapshot")
  }
  return transitioned({
    ...state,
    state_revision: state.state_revision + 1,
    intervention_satisfied: state.status === "AWAITING_HUMAN" && state.awaiting_reason !== "CHECKPOINT"
      ? true
      : state.intervention_satisfied,
    profile_snapshot: event.profile_snapshot ?? state.profile_snapshot,
    reference_snapshot: event.reference_snapshot ?? state.reference_snapshot,
  })
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected workflow state: ${String(value)}`)
}
