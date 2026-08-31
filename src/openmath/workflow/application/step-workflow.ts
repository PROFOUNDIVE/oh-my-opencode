import type { WorkflowStateV1 } from "../state"
import { runWorkflowStep, type StageRunnerRuntime } from "../stage-runner"
import { readWorkflowState } from "../storage"
import { reduceTransition, type StepMode } from "../transitions"
import { serializeWorkflowInputSnapshot } from "./serialize-workflow-input-snapshot"
import type { WorkflowApplicationResult } from "./workflow-application-result"
import { admitResearchTerminalState, ResearchTerminalAdmissionError } from "./research-terminal-admission"
import type { ApprovedEducationalSourceResult } from "../../research/educationalization/approved-source"
import { StagePersistenceError } from "../stage-runner/stage-persistence-error"

export async function stepWorkflow(input: Readonly<{
  readonly directory: string
  readonly run_id: string
  readonly expected_state_revision: number
  readonly mode: StepMode
}>, dependencies: Readonly<{
  readonly create_runtime: (state: WorkflowStateV1) => StageRunnerRuntime | undefined
  readonly validate_research_terminal?: () => Promise<ApprovedEducationalSourceResult>
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
  try {
    const state = await runWorkflowStep({
      state: current.state,
      workflow_input: serializeWorkflowInputSnapshot(current.state.request_snapshot),
      mode: input.mode,
      runtime: {
        ...runtime,
        persist: async (nextState) => {
          await admitResearchTerminalState({
            directory: input.directory,
            state: nextState,
            ...(dependencies.validate_research_terminal === undefined
              ? {}
              : { validate_source: dependencies.validate_research_terminal }),
          })
          return runtime.persist(nextState)
        },
      },
    })
    return { kind: "ok", state }
  } catch (error) {
    if (error instanceof ResearchTerminalAdmissionError) {
      return { kind: "error", error_code: error.error_code, message: error.message }
    }
    if (error instanceof StagePersistenceError) {
      return { kind: "error", error_code: error.error_code, message: error.message }
    }
    throw error
  }
}
