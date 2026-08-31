import { parseFrozenCandidateSources, type FrozenCandidateSources } from "../../candidates/frozen-candidate-sources"
import type { CandidateDescriptor, ResearchCampaignStateV1 } from "../../state"
import type { CertificationApplicationFailure } from "./certification-application-types"

export type CertificationSelectionResult =
  | Readonly<{ readonly kind: "disabled"; readonly campaign: ResearchCampaignStateV1 }>
  | Readonly<{
      readonly kind: "enabled"
      readonly campaign: ResearchCampaignStateV1
      readonly candidate: CandidateDescriptor & Readonly<{
        readonly child_state_revision: number
        readonly artifact: NonNullable<CandidateDescriptor["artifact"]>
      }>
      readonly sources: FrozenCandidateSources
    }>
  | CertificationApplicationFailure

export function selectCertificationSource(campaign: ResearchCampaignStateV1): CertificationSelectionResult {
  const frozen = parseFrozenCandidateSources(campaign)
  if (!frozen.ok) return failure("PROFILE_HASH_MISMATCH", frozen.message)
  if (frozen.sources.profile.certification === undefined) return { kind: "disabled", campaign }
  if (campaign.phase !== "PROMOTION" || campaign.selected_candidate_id === null) {
    return failure("CAMPAIGN_NOT_ELIGIBLE", "Certification requires the promotion seam")
  }
  const candidate = campaign.candidates.find((item) => item.candidate_id === campaign.selected_candidate_id)
  if (candidate === undefined || candidate.child_state_revision === null || candidate.artifact === null) {
    return failure("STALE_ARTIFACT", "Selected campaign artifact is unavailable")
  }
  return { kind: "enabled", campaign, candidate: definedCandidate(candidate), sources: frozen.sources }
}

function definedCandidate(candidate: CandidateDescriptor) {
  if (candidate.child_state_revision === null || candidate.artifact === null) {
    throw new TypeError("Selected certification candidate is incomplete")
  }
  return { ...candidate, child_state_revision: candidate.child_state_revision, artifact: candidate.artifact }
}

function failure(
  errorCode: CertificationApplicationFailure["error_code"],
  message: string,
): CertificationApplicationFailure {
  return { kind: "error", error_code: errorCode, message }
}
