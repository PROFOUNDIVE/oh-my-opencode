import type { WorkflowStateV1 } from "../state"
import { runWorkflowStep, type StageRunnerRuntime } from "../stage-runner"
import { readWorkflowState } from "../storage"
import { reduceTransition, type StepMode } from "../transitions"
import { serializeWorkflowInputSnapshot } from "./serialize-workflow-input-snapshot"
import type { WorkflowApplicationResult } from "./workflow-application-result"

export async function stepWorkflow(input: Readonly<{
  readonly directory: string
  readonly run_id: string
  readonly expected_state_revision: number
  readonly mode: StepMode
}>, dependencies: Readonly<{
  readonly create_runtime: (state: WorkflowStateV1) => StageRunnerRuntime | undefined
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
  if (current.state.request_snapshot === undefined) {
    return { kind: "error", error_code: "STORAGE_READ_FAILED", message: "Workflow request snapshot is missing" }
  }
  const preflight = reduceTransition(current.state, { type: "STEP", mode: input.mode })
  if (!preflight.ok) return { kind: "error", error_code: preflight.error_code, message: preflight.message }
  const runtime = dependencies.create_runtime(current.state)
  if (runtime === undefined) {
    return { kind: "error", error_code: "SUBAGENT_FAILED", message: "OpenCode client is required to execute workflow stages" }
  }
  const state = await runWorkflowStep({
    state: current.state,
    workflow_input: serializeWorkflowInputSnapshot(current.state.request_snapshot),
    mode: input.mode,
    runtime,
  })
  return { kind: "ok", state }
}
