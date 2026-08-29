import type { WorkflowRequestSnapshot } from "../state"

export function serializeWorkflowInputSnapshot(snapshot: WorkflowRequestSnapshot): string {
  return JSON.stringify(snapshot)
}
