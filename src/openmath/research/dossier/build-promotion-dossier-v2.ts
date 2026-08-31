import type { WorkflowStateV1 } from "../../workflow/state"
import { sha256 } from "../../workflow/stage-runner/sha256"
import { parseFrozenCandidateSources } from "../candidates/frozen-candidate-sources"
import { buildCertificationAttachmentReference } from "../certification/state/attachment-reference"
import { hashResearchCertificationState, type ResearchCertificationStateV1 } from "../certification/state/schema"
import type { ResearchCampaignStateV1 } from "../state"
import { PromotionDossierReferenceSchema } from "../state"
import { buildPromotionDossier } from "./build-promotion-dossier"
import { PromotionDossierV2Schema, type PromotionDossierV2 } from "./promotion-dossier-v2-schema"

export type PromotionDossierV2BuildResult =
  | Readonly<{
      readonly ok: true
      readonly dossier: PromotionDossierV2
      readonly reference: ReturnType<typeof PromotionDossierReferenceSchema.parse>
    }>
  | Readonly<{ readonly ok: false; readonly message: string }>

export function buildPromotionDossierV2(input: Readonly<{
  readonly campaign: ResearchCampaignStateV1
  readonly child: WorkflowStateV1
  readonly certification: ResearchCertificationStateV1
  readonly certification_content_sha256: string
}>): PromotionDossierV2BuildResult {
  const frozen = parseFrozenCandidateSources(input.campaign)
  const profile = frozen.ok ? frozen.sources.profile.certification : undefined
  if (profile === undefined) return invalid("PromotionDossierV2 requires an enabled frozen certification profile")
  const attachment = input.campaign.attachments.find((candidate) => candidate.kind === "research-certification")
  if (attachment === undefined || input.campaign.attachments.filter((candidate) => candidate.kind === "research-certification").length !== 1) {
    return invalid("PromotionDossierV2 requires exactly one certification attachment")
  }
  if (input.certification.status !== "COMPLETE"
    || hashResearchCertificationState(input.certification) !== input.certification_content_sha256
    || input.certification_content_sha256 !== attachment.content_sha256) {
    return invalid("PromotionDossierV2 requires a complete hash-valid certification sidecar")
  }
  const expectedAttachment = buildCertificationAttachmentReference({
    generation_id: input.certification.generation_id,
    certification_revision: input.certification.certification_revision,
    content_sha256: input.certification_content_sha256,
  })
  if (JSON.stringify(attachment) !== JSON.stringify(expectedAttachment)) {
    return invalid("PromotionDossierV2 certification attachment identity is stale")
  }
  const selected = input.campaign.candidates.find((candidate) => candidate.candidate_id === input.campaign.selected_candidate_id)
  const artifact = selected?.artifact
  const observedArtifact = selected === undefined || selected.child_state_revision === null || artifact === null || artifact === undefined
    ? null
    : {
        candidate_id: selected.candidate_id,
        child_run_id: selected.child_run_id,
        child_state_revision: selected.child_state_revision,
        artifact_version: artifact.artifact_version,
        media_type: artifact.media_type,
        artifact_sha256: artifact.sha256,
      }
  if (observedArtifact === null || JSON.stringify(observedArtifact) !== JSON.stringify(input.certification.selected_artifact)
    || input.certification.campaign_id !== input.campaign.campaign_id
    || String(input.certification.objective_sha256) !== String(input.campaign.source_snapshot.objective.sha256)
    || String(input.certification.profile_sha256) !== String(input.campaign.source_snapshot.profile.sha256)
    || String(input.certification.reference_sha256) !== String(input.campaign.source_snapshot.references.sha256)
    || String(input.certification.certification_profile_sha256) !== profile.certification_profile_hash) {
    return invalid("PromotionDossierV2 certification identities are stale")
  }
  if (input.child.artifact === null || sha256(input.child.artifact.content) !== observedArtifact.artifact_sha256) {
    return invalid("PromotionDossierV2 selected artifact bytes are stale")
  }
  const shared = buildPromotionDossier({ campaign: input.campaign, child: input.child })
  if (!shared.ok) return shared
  const dossier = PromotionDossierV2Schema.parse({
    ...shared.dossier,
    schema_version: 2,
    certification_summary: input.certification.summary,
    certification_attachment: attachment,
  })
  const serializedBytes = JSON.stringify(dossier)
  return {
    ok: true,
    dossier,
    reference: PromotionDossierReferenceSchema.parse({
      ...shared.reference,
      serialized_bytes: serializedBytes,
      content_sha256: sha256(serializedBytes),
      attachments: dossier.attachments,
    }),
  }
}

function invalid(message: string): Extract<PromotionDossierV2BuildResult, { readonly ok: false }> {
  return { ok: false, message }
}
