import { compareAndSwapWorkflowState, readWorkflowState } from "../storage"
import { reduceTransition, type WorkflowTransitionEvent } from "../transitions"
import type { WorkflowApplicationResult } from "./workflow-application-result"

type AmendWorkflowInput = Readonly<{
  readonly directory: string
  readonly run_id: string
  readonly expected_state_revision: number
}> & (
  | Readonly<{
      readonly operation: "add"
      readonly kind: "question" | "required_check" | "suspected_blocker" | "scope_change"
      readonly scope: string
      readonly content: string
    }>
  | Readonly<{ readonly operation: "retract"; readonly amendment_id: string }>
)

export async function amendWorkflow(input: AmendWorkflowInput): Promise<WorkflowApplicationResult> {
  const current = await readWorkflowState(input.directory, input.run_id)
  if (current.kind === "error") return current
  if (current.state.state_revision !== input.expected_state_revision) {
    return staleRevision(input.expected_state_revision, current.state.state_revision)
  }
  const transition = reduceTransition(current.state, amendmentEvent(input))
  if (!transition.ok) return { kind: "error", error_code: transition.error_code, message: transition.message }
  return compareAndSwapWorkflowState({
    directory: input.directory,
    run_id: input.run_id,
    expected_state_revision: input.expected_state_revision,
    next_state: transition.state,
  })
}

function amendmentEvent(input: AmendWorkflowInput): WorkflowTransitionEvent {
  switch (input.operation) {
    case "add":
      return { type: "ADD_AMENDMENT", kind: input.kind, scope: input.scope, content: input.content }
    case "retract":
      return { type: "RETRACT_AMENDMENT", amendment_id: input.amendment_id }
    default:
      return assertNever(input)
  }
}

function staleRevision(expected: number, current: number): WorkflowApplicationResult {
  return {
    kind: "error",
    error_code: "STALE_STATE_REVISION",
    message: `Expected revision ${expected}, found ${current}`,
    current_state_revision: current,
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected amendment operation: ${String(value)}`)
}
