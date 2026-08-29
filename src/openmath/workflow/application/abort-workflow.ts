import { compareAndSwapWorkflowState, readWorkflowState } from "../storage"
import { reduceTransition } from "../transitions"
import type { WorkflowApplicationResult } from "./workflow-application-result"

export async function abortWorkflow(input: Readonly<{
  readonly directory: string
  readonly run_id: string
  readonly expected_state_revision: number
  readonly reason?: string
}>): Promise<WorkflowApplicationResult> {
  const current = await readWorkflowState(input.directory, input.run_id)
  if (current.kind === "error") return current
  if (current.state.state_revision !== input.expected_state_revision) {
    return {
      kind: "error",
      error_code: "STALE_STATE_REVISION",
      message: `Expected revision ${input.expected_state_revision}, found ${current.state.state_revision}`,
      current_state_revision: current.state.state_revision,
    }
  }
  const transition = reduceTransition(current.state, { type: "ABORT", reason: input.reason })
  if (!transition.ok) return { kind: "error", error_code: transition.error_code, message: transition.message }
  return compareAndSwapWorkflowState({
    directory: input.directory,
    run_id: input.run_id,
    expected_state_revision: input.expected_state_revision,
    next_state: transition.state,
  })
}
