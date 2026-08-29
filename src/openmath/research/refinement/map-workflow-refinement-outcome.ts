import type { WorkflowStateV1 } from "../../workflow/state"
import type { CampaignErrorCode } from "../application"
import { CandidateDescriptorSchema, type CandidateDescriptor } from "../state"
import type { CampaignChildResult } from "../transitions"

export type WorkflowRefinementOutcome =
  | { readonly ok: true; readonly child_result: CampaignChildResult }
  | { readonly ok: false; readonly error_code: CampaignErrorCode; readonly message: string }

export function mapWorkflowRefinementOutcome(
  candidate: CandidateDescriptor,
  state: WorkflowStateV1,
): WorkflowRefinementOutcome {
  if (state.run_id !== candidate.child_run_id) return invalid("Selected child workflow identity changed")
  switch (state.status) {
    case "PASSED": {
      const updated = candidateWithArtifact(candidate, state)
      return updated === null
        ? invalid("Passed child workflow has no artifact")
        : { ok: true, child_result: { status: "PASSED", candidate: updated } }
    }
    case "AWAITING_HUMAN": {
      if (state.awaiting_reason === "CHECKPOINT") {
        return invalid("Selected child stopped at the discovery checkpoint instead of refinement intervention")
      }
      const updated = candidateWithArtifact(candidate, state)
      return updated === null
        ? invalid("Paused child workflow has no artifact")
        : { ok: true, child_result: { status: "AWAITING_HUMAN", candidate: updated } }
    }
    case "BLOCKED":
      return { ok: true, child_result: { status: "BLOCKED", reason: state.blocked_reason } }
    case "EXHAUSTED":
      return { ok: true, child_result: { status: "EXHAUSTED" } }
    case "ABORTED":
      return { ok: true, child_result: { status: "ABORTED" } }
    case "READY":
    case "RUNNING":
      return invalid("Selected child workflow did not reach a refinement outcome")
    default:
      return assertNever(state)
  }
}

function candidateWithArtifact(candidate: CandidateDescriptor, state: WorkflowStateV1): CandidateDescriptor | null {
  if (state.artifact === null) return null
  return CandidateDescriptorSchema.parse({
    ...candidate,
    child_state_revision: state.state_revision,
    artifact: {
      child_run_id: candidate.child_run_id,
      child_state_revision: state.state_revision,
      artifact_version: state.artifact.version,
      media_type: state.artifact.media_type,
      sha256: state.artifact.sha256,
    },
  })
}

function invalid(message: string): Extract<WorkflowRefinementOutcome, { readonly ok: false }> {
  return { ok: false, error_code: "CHILD_WORKFLOW_FAILED", message }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected workflow refinement status: ${String(value)}`)
}
