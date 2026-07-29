import type { WorkflowStateV1 } from "../state"

export type WorkflowStageInput = Readonly<{
  readonly system_content: string | undefined
  readonly user_prompt: string
}>

export type BuildWorkflowStageInput = Readonly<{
  readonly state: WorkflowStateV1
  readonly workflow_input: string
}>
