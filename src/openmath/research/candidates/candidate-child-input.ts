import type { ReferenceSnapshot } from "../../references/types"
import type { WorkflowRequestSnapshot, WorkflowStateV1 } from "../../workflow/state"

export type CandidateChildWorkflowInput = Readonly<{
  readonly request_snapshot: WorkflowRequestSnapshot
  readonly profile_snapshot: WorkflowStateV1["profile_snapshot"]
  readonly reference_snapshot: ReferenceSnapshot
  readonly strategy_prompt: string
}>

export function serializeCandidateChildWorkflowInput(input: CandidateChildWorkflowInput): string {
  return JSON.stringify({
    request_snapshot: input.request_snapshot,
    profile_snapshot: input.profile_snapshot,
    reference_snapshot: input.reference_snapshot,
    strategy_prompt: input.strategy_prompt,
  })
}
