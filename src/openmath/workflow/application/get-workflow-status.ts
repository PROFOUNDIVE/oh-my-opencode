import { readWorkflowState, type WorkflowReadResult } from "../storage"

export async function getWorkflowStatus(input: Readonly<{
  readonly directory: string
  readonly run_id: string
}>): Promise<WorkflowReadResult> {
  return readWorkflowState(input.directory, input.run_id)
}
