import type { WorkflowStateV1 } from "../state"
import { reduceTransition, type StepMode } from "../transitions"
import { runWorkflowStage } from "./run-workflow-stage"
import type { StageRunnerRuntime } from "./stage-runner-types"

export async function runWorkflowStep(input: Readonly<{
  readonly state: WorkflowStateV1
  readonly workflow_input: string
  readonly mode: StepMode
  readonly runtime: StageRunnerRuntime
}>): Promise<WorkflowStateV1> {
  const initial = await startOrResumeStage(input)
  if (input.mode === "one_stage" || initial.status !== "READY") return initial
  return continueToCheckpoint({ ...input, state: initial })
}

async function startOrResumeStage(input: Readonly<{
  readonly state: WorkflowStateV1
  readonly workflow_input: string
  readonly mode: StepMode
  readonly runtime: StageRunnerRuntime
}>): Promise<WorkflowStateV1> {
  const transition = reduceTransition(input.state, { type: "STEP", mode: input.mode })
  if (!transition.ok) return transition.state
  switch (transition.directive) {
    case "dispatch": {
      const state = await input.runtime.persist(transition.state)
      if (state.status !== "RUNNING") return state
      return runWorkflowStage({ state, workflow_input: input.workflow_input, runtime: input.runtime })
    }
    case "reconcile": {
      const state = await resumeBlockedState(transition.state, input.runtime)
      if (state.status !== "RUNNING") return state
      return runWorkflowStage({ state, workflow_input: input.workflow_input, runtime: input.runtime })
    }
    case "none":
      return transition.state
    default:
      throw new TypeError(`Unexpected workflow step directive: ${transition.directive}`)
  }
}

async function continueToCheckpoint(input: Readonly<{
  readonly state: Extract<WorkflowStateV1, { readonly status: "READY" }>
  readonly workflow_input: string
  readonly mode: StepMode
  readonly runtime: StageRunnerRuntime
}>): Promise<WorkflowStateV1> {
  const transition = reduceTransition(input.state, { type: "STEP", mode: input.mode })
  if (!transition.ok || transition.directive !== "dispatch") return transition.state
  const state = await input.runtime.persist(transition.state)
  if (state.status !== "RUNNING") return state
  const completed = await runWorkflowStage({ state, workflow_input: input.workflow_input, runtime: input.runtime })
  return completed.status === "READY"
    ? continueToCheckpoint({ ...input, state: completed })
    : completed
}

async function resumeBlockedState(state: WorkflowStateV1, runtime: StageRunnerRuntime): Promise<WorkflowStateV1> {
  if (state.status !== "BLOCKED") return state
  return runtime.persist({
    ...state,
    status: "RUNNING",
    awaiting_reason: null,
    abort_requested: false,
    abort_reason: null,
    blocked_reason: null,
    intervention_satisfied: false,
  })
}
