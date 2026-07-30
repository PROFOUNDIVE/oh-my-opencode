import { compareAndSwapWorkflowState, readWorkflowState } from "../../openmath/workflow/storage"
import { reduceTransition, type WorkflowTransitionEvent } from "../../openmath/workflow/transitions"
import type { WorkflowStateV1 } from "../../openmath/workflow/state"
import { jsonWorkflowError, jsonWorkflowSuccess } from "./envelope"

export async function mutateWorkflow(input: Readonly<{
  readonly directory: string
  readonly run_id: string
  readonly expected_state_revision: number
  readonly event: WorkflowTransitionEvent
}>): Promise<string> {
  const current = await readWorkflowState(input.directory, input.run_id)
  if (current.kind === "error") return jsonWorkflowError(current)
  if (current.state.state_revision !== input.expected_state_revision) {
    return jsonWorkflowError({
      error_code: "STALE_STATE_REVISION",
      message: `Expected revision ${input.expected_state_revision}, found ${current.state.state_revision}`,
      current_state_revision: current.state.state_revision,
    })
  }
  const transition = reduceTransition(current.state, input.event)
  if (!transition.ok) return jsonWorkflowError({ error_code: transition.error_code, message: transition.message })
  return writeMutation({
    directory: input.directory,
    run_id: input.run_id,
    expected_state_revision: input.expected_state_revision,
    next_state: transition.state,
  })
}

export async function mutateWorkflowFromState(input: Readonly<{
  readonly directory: string
  readonly run_id: string
  readonly expected_state_revision: number
  readonly preflight_event: (state: WorkflowStateV1) => WorkflowTransitionEvent
  readonly build_event: (state: WorkflowStateV1) => Promise<WorkflowTransitionEvent>
}>): Promise<string> {
  const current = await readWorkflowState(input.directory, input.run_id)
  if (current.kind === "error") return jsonWorkflowError(current)
  if (current.state.state_revision !== input.expected_state_revision) {
    return jsonWorkflowError({ error_code: "STALE_STATE_REVISION", message: `Expected revision ${input.expected_state_revision}, found ${current.state.state_revision}`, current_state_revision: current.state.state_revision })
  }
  const preflight = reduceTransition(current.state, input.preflight_event(current.state))
  if (!preflight.ok) return jsonWorkflowError({ error_code: preflight.error_code, message: preflight.message })
  const transition = reduceTransition(current.state, await input.build_event(current.state))
  if (!transition.ok) return jsonWorkflowError({ error_code: transition.error_code, message: transition.message })
  return writeMutation({ directory: input.directory, run_id: input.run_id, expected_state_revision: input.expected_state_revision, next_state: transition.state })
}

async function writeMutation(input: Readonly<{
  readonly directory: string
  readonly run_id: string
  readonly expected_state_revision: number
  readonly next_state: WorkflowStateV1
}>): Promise<string> {
  const written = await compareAndSwapWorkflowState(input)
  return written.kind === "ok" ? jsonWorkflowSuccess(written.state) : jsonWorkflowError(written)
}
