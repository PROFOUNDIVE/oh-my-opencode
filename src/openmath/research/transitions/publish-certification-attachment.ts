import { buildCertificationAttachmentReference } from "../certification/state/attachment-reference"
import { deriveCertificationIdentity } from "../certification/state/identity"
import { parseFrozenCandidateSources } from "../candidates/frozen-candidate-sources"
import type { ResearchCampaignStateV1 } from "../state"
import { illegal, invalid, validated } from "./transition-result"
import type { CampaignTransitionEvent, CampaignTransitionResult } from "./types"

type PublicationEvent = Extract<CampaignTransitionEvent, { readonly type: "PUBLISH_CERTIFICATION_ATTACHMENT" }>

export function reducePublishCertificationAttachment(
  state: ResearchCampaignStateV1,
  event: PublicationEvent,
): CampaignTransitionResult {
  if (state.phase !== "PROMOTION" || state.status !== "READY" || state.dossier !== null) {
    return illegal(state, "Certification attachment publication requires READY promotion before dossier creation")
  }
  const frozen = parseFrozenCandidateSources(state)
  const certification = frozen.ok ? frozen.sources.profile.certification : undefined
  if (certification === undefined
    || certification.certification_profile_hash !== event.certification_profile_sha256) {
    return invalid(state, "Certification attachment profile identity is stale")
  }
  const selected = state.candidates.find((candidate) => candidate.candidate_id === state.selected_candidate_id)
  if (selected === undefined || selected.child_state_revision === null || selected.artifact === null) {
    return invalid(state, "Certification attachment selected artifact is unavailable")
  }
  const observedArtifact = {
    candidate_id: selected.candidate_id,
    child_run_id: selected.child_run_id,
    child_state_revision: selected.child_state_revision,
    artifact_version: selected.artifact.artifact_version,
    media_type: selected.artifact.media_type,
    artifact_sha256: selected.artifact.sha256,
  }
  const expectedIdentity = deriveCertificationIdentity({
    campaign_id: state.campaign_id,
    selected_artifact_sha256: selected.artifact.sha256,
    certification_profile_sha256: certification.certification_profile_hash,
  })
  const expectedAttachment = buildCertificationAttachmentReference({
    generation_id: expectedIdentity.generation_id,
    certification_revision: event.certification_revision,
    content_sha256: event.attachment.content_sha256,
  })
  if (JSON.stringify(observedArtifact) !== JSON.stringify(event.selected_artifact)
    || event.generation_id !== expectedIdentity.generation_id
    || JSON.stringify(event.attachment) !== JSON.stringify(expectedAttachment)) {
    return invalid(state, "Certification attachment identity is invalid")
  }
  if (state.attachments.some((attachment) => attachment.kind === "research-certification")) {
    return illegal(state, "Certification attachment is already published")
  }
  return validated(state, {
    ...state,
    state_revision: state.state_revision + 1,
    attachments: [...state.attachments, expectedAttachment],
  })
}
