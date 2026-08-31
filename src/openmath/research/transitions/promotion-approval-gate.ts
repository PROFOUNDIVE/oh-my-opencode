import { parseFrozenCandidateSources } from "../candidates/frozen-candidate-sources"
import { buildCertificationAttachmentReference } from "../certification/state/attachment-reference"
import { hashResearchCertificationState, ResearchCertificationStateV1Schema } from "../certification/state/schema"
import { PromotionDossierV1Schema } from "../dossier/promotion-dossier-schema"
import { PromotionDossierV2Schema } from "../dossier/promotion-dossier-v2-schema"
import type { ResearchCampaignStateV1 } from "../state"
import type { CampaignTransitionEvent } from "./types"

type PromoteEvent = Extract<CampaignTransitionEvent, { readonly type: "PROMOTE" }>

export type PromotionApprovalGateResult =
  | Readonly<{ readonly ok: true }>
  | Readonly<{ readonly ok: false; readonly message: string }>

export function admitPromotionDecision(
  campaign: ResearchCampaignStateV1,
  event: PromoteEvent,
): PromotionApprovalGateResult {
  const frozen = parseFrozenCandidateSources(campaign)
  if (!frozen.ok) return parseV1(campaign.dossier?.serialized_bytes) ? { ok: true } : failure(frozen.message)
  const profile = frozen.sources.profile.certification
  if (profile === undefined) {
    return event.certification_evidence === undefined
      ? { ok: true }
      : failure("PromotionDossierV1 cannot carry certification evidence")
  }
  if (event.decision_receipt.decision === "reject") return { ok: true }
  const evidence = event.certification_evidence
  const dossier = campaign.dossier
  if (evidence === undefined || dossier === null) return failure("PromotionDossierV2 approval requires current certification evidence")
  const parsedDossier = parseV2(dossier.serialized_bytes)
  const parsedCertification = ResearchCertificationStateV1Schema.safeParse(evidence.state)
  if (parsedDossier === null || !parsedCertification.success || parsedCertification.data.status !== "COMPLETE") {
    return failure("PromotionDossierV2 approval requires strict complete evidence")
  }
  const certification = parsedCertification.data
  const selected = campaign.candidates.find((candidate) => candidate.candidate_id === campaign.selected_candidate_id)
  const artifact = selected?.artifact
  if (selected === undefined || selected.child_state_revision === null || artifact === null || artifact === undefined) {
    return failure("PromotionDossierV2 selected artifact is unavailable")
  }
  const observedArtifact = {
    candidate_id: selected.candidate_id,
    child_run_id: selected.child_run_id,
    child_state_revision: selected.child_state_revision,
    artifact_version: artifact.artifact_version,
    media_type: artifact.media_type,
    artifact_sha256: artifact.sha256,
  }
  const expectedAttachment = buildCertificationAttachmentReference({
    generation_id: certification.generation_id,
    certification_revision: certification.certification_revision,
    content_sha256: evidence.content_sha256,
  })
  if (event.decision_receipt.campaign_revision !== campaign.state_revision
    || parsedDossier.created_at_revision !== campaign.state_revision
    || certification.campaign_id !== campaign.campaign_id
    || certification.certification_revision !== parsedDossier.certification_summary.certification_revision
    || JSON.stringify(certification.summary) !== JSON.stringify(parsedDossier.certification_summary)
    || JSON.stringify(certification.selected_artifact) !== JSON.stringify(observedArtifact)
    || JSON.stringify(evidence.observed_selected_artifact) !== JSON.stringify(observedArtifact)
    || evidence.artifact_content_sha256 !== artifact.sha256
    || String(certification.objective_sha256) !== String(campaign.source_snapshot.objective.sha256)
    || String(certification.profile_sha256) !== String(campaign.source_snapshot.profile.sha256)
    || String(certification.reference_sha256) !== String(campaign.source_snapshot.references.sha256)
    || String(certification.certification_profile_sha256) !== profile.certification_profile_hash) {
    return failure("PromotionDossierV2 approval evidence is stale")
  }
  const exactHash = hashResearchCertificationState(certification)
  if (evidence.content_sha256 !== exactHash
    || parsedDossier.certification_attachment.content_sha256 !== exactHash
    || JSON.stringify(parsedDossier.certification_attachment) !== JSON.stringify(expectedAttachment)) {
    return failure("PromotionDossierV2 approval hashes do not match exact current evidence")
  }
  return certification.summary.approval_eligible
    ? { ok: true }
    : failure("PromotionDossierV2 certification is not approval eligible")
}

function parseV2(serialized: string) {
  try {
    const parsed = PromotionDossierV2Schema.safeParse(JSON.parse(serialized))
    return parsed.success ? parsed.data : null
  } catch (error) {
    if (error instanceof SyntaxError) return null
    throw error
  }
}

function parseV1(serialized: string | undefined): boolean {
  if (serialized === undefined) return false
  try {
    return PromotionDossierV1Schema.safeParse(JSON.parse(serialized)).success
  } catch (error) {
    if (error instanceof SyntaxError) return false
    throw error
  }
}

function failure(message: string): PromotionApprovalGateResult {
  return { ok: false, message }
}
