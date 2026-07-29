import { AmendmentKindSchema, AmendmentScopeSchema } from "../state/literals"
import type { WorkflowStateV1 } from "../state"
import { isAmendmentApplicable, isAmendmentScope } from "./amendment-state"
import { rejected, transitioned } from "./result"
import type { TransitionResult, WorkflowTransitionEvent } from "./types"

type AddEvent = Extract<WorkflowTransitionEvent, { readonly type: "ADD_AMENDMENT" }>

export function reduceAddAmendment(state: WorkflowStateV1, event: AddEvent): TransitionResult {
  switch (state.status) {
    case "READY":
    case "AWAITING_HUMAN":
      return addAmendment(state, event)
    case "RUNNING":
    case "BLOCKED":
    case "PASSED":
    case "EXHAUSTED":
    case "ABORTED":
      return rejected(state, "ILLEGAL_TRANSITION", `Cannot add an amendment while workflow is ${state.status}`)
    default:
      return assertNever(state)
  }
}

function addAmendment(
  state: Extract<WorkflowStateV1, { readonly status: "READY" | "AWAITING_HUMAN" }>,
  event: AddEvent,
): TransitionResult {
  const kind = AmendmentKindSchema.safeParse(event.kind)
  const scope = AmendmentScopeSchema.safeParse(event.scope)
  if (!kind.success || !scope.success || !isAmendmentScope(scope.data) || event.content.trim().length === 0) {
    return rejected(state, "VALIDATION_ERROR", "Amendment kind, scope, and content must match the fixed contract")
  }
  const revision = state.state_revision + 1
  const interventionSatisfied = state.status === "AWAITING_HUMAN"
    && state.awaiting_reason !== "CHECKPOINT"
    && isAmendmentApplicable(scope.data, state, state.next_stage)
  return transitioned({
    ...state,
    state_revision: revision,
    intervention_satisfied: state.intervention_satisfied || interventionSatisfied,
    amendments: [...state.amendments, {
      event_type: "ADDED",
      amendment_id: `amendment-${revision}`,
      kind: kind.data,
      scope: scope.data,
      content: event.content,
      lifecycle: "ACTIVE",
      state_revision: revision,
    }],
  })
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected workflow state: ${String(value)}`)
}
