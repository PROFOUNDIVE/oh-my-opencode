import type { WorkflowStateV1 } from "../../workflow/state"
import type { CandidateDescriptor, ResearchCampaignStateV1 } from "../state"
import { parseFrozenCandidateSources } from "../candidates/frozen-candidate-sources"
import { renderApplicableCampaignAmendments } from "../transitions"

export type SelectedChildStateValidation =
  | { readonly ok: true; readonly forwarded_amendment_count: number }
  | { readonly ok: false; readonly message: string }

export function validateSelectedChildState(input: Readonly<{
  readonly campaign: ResearchCampaignStateV1
  readonly candidate: CandidateDescriptor
  readonly child: WorkflowStateV1
}>): SelectedChildStateValidation {
  const frozen = parseFrozenCandidateSources(input.campaign)
  if (!frozen.ok) return invalid(frozen.message)
  if (input.child.run_id !== input.candidate.child_run_id
    || input.child.parent_session_id !== input.campaign.parent_session_id
    || JSON.stringify(input.child.request_snapshot) !== JSON.stringify(frozen.sources.objective)
    || JSON.stringify(input.child.profile_snapshot) !== JSON.stringify(frozen.sources.profile.candidate_workflow_profile)
    || JSON.stringify(input.child.reference_snapshot) !== JSON.stringify(frozen.sources.references)) {
    return invalid("Selected child workflow does not match the frozen campaign inputs")
  }
  const persistedRevision = input.candidate.child_state_revision
  if (persistedRevision === null) return invalid("Selected child workflow revision is unavailable")
  const amendments = renderApplicableCampaignAmendments(input.campaign, "DEEP_REFINEMENT")
  const forwarded = input.child.amendments.filter((event): event is Extract<WorkflowStateV1["amendments"][number], { readonly event_type: "ADDED" }> => (
    event.event_type === "ADDED" && event.state_revision > persistedRevision
  ))
  const expectedRevision = persistedRevision + forwarded.length
  const activeRefinement = hasActiveRefinementJob(input.campaign, input.candidate)
    && input.child.dispatch_attempts.some((attempt) => attempt.state_revision > expectedRevision)
  if ((!activeRefinement && input.child.state_revision !== expectedRevision)
    || (activeRefinement && input.child.state_revision < expectedRevision)
    || forwarded.length > amendments.length) {
    return invalid("Selected child workflow revision changed outside persisted refinement amendments")
  }
  if (forwarded.some((childAmendment, index) => {
    const amendment = amendments[index]
    return amendment === undefined
      || childAmendment.kind !== amendment.kind
      || childAmendment.scope !== "all_remaining"
      || childAmendment.content !== amendment.content
  })) {
    return invalid("Selected refinement amendments do not match the child workflow history")
  }
  if (input.candidate.artifact !== null && input.child.state_revision === expectedRevision) {
    const artifact = input.child.artifact
    if (artifact === null
      || artifact.version !== input.candidate.artifact.artifact_version
      || artifact.media_type !== input.candidate.artifact.media_type
      || artifact.sha256 !== input.candidate.artifact.sha256) {
      return invalid("Selected child artifact no longer matches its tournament-selected reference")
    }
  }
  return { ok: true, forwarded_amendment_count: forwarded.length }
}

function hasActiveRefinementJob(
  campaign: ResearchCampaignStateV1,
  candidate: CandidateDescriptor,
): boolean {
  return campaign.status === "RUNNING" && campaign.phase === "DEEP_REFINEMENT"
    && campaign.active_job_ids.some((jobId) => campaign.job_attempts.some((job) => (
      job.job_id === jobId && job.target.kind === "CANDIDATE"
      && job.target.candidate_id === candidate.candidate_id && job.phase !== "COMMITTED"
    )))
}

function invalid(message: string): Extract<SelectedChildStateValidation, { readonly ok: false }> {
  return { ok: false, message }
}
