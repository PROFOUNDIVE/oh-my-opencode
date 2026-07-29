import type { WorkflowStateV1 } from "../state"
import { progressStageAttempt } from "./progress-stage-attempt"
import type { StageRunnerRuntime } from "./stage-runner-types"

export type { StageRunnerRuntime, StageSubagentDispatch } from "./stage-runner-types"

export async function runWorkflowStage(input: Readonly<{
  readonly state: Extract<WorkflowStateV1, { readonly status: "RUNNING" }>
  readonly workflow_input: string
  readonly runtime: StageRunnerRuntime
}>): Promise<WorkflowStateV1> {
  return progressStageAttempt(input)
}
