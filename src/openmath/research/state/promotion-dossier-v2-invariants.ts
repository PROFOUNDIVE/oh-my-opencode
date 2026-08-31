import type { z } from "zod"

import { buildCertificationAttachmentReference } from "../certification/state/attachment-reference"
import { deriveCertificationIdentity } from "../certification/state/identity"
import { PromotionDossierV2Schema } from "../dossier/promotion-dossier-v2-schema"
import type { FrozenCandidateSources } from "../candidates/frozen-candidate-sources"
import type { AggregateInvariantInput } from "./aggregate-invariant-input"
import { addPromotionIssue, parsePromotionJson } from "./promotion-invariant-helpers"
import { validatePromotionDossierSemantics } from "./promotion-dossier-semantic-invariants"

export function validatePromotionDossierV2(
  state: AggregateInvariantInput,
  sources: FrozenCandidateSources,
  context: z.RefinementCtx,
): void {
  const reference = state.dossier
  const profile = sources.profile.certification
  if (reference === null || profile === undefined) return
  const parsed = PromotionDossierV2Schema.safeParse(parsePromotionJson(reference.serialized_bytes))
  if (!parsed.success) {
    addPromotionIssue(context, ["dossier", "serialized_bytes"], "Dossier bytes must contain strict PromotionDossierV2 JSON")
    return
  }
  validatePromotionDossierSemantics(state, parsed.data, context)
  const content = parsed.data
  const selected = state.candidates.find((candidate) => candidate.candidate_id === state.selected_candidate_id)
  const artifact = selected?.artifact
  if (selected === undefined || artifact === null || artifact === undefined) {
    addPromotionIssue(context, ["dossier", "certification_summary"], "Certification summary requires the selected artifact")
    return
  }
  const identity = deriveCertificationIdentity({
    campaign_id: state.campaign_id,
    selected_artifact_sha256: artifact.sha256,
    certification_profile_sha256: profile.certification_profile_hash,
  })
  const expectedAttachment = buildCertificationAttachmentReference({
    generation_id: content.certification_summary.generation_id,
    certification_revision: content.certification_summary.certification_revision,
    content_sha256: content.certification_attachment.content_sha256,
  })
  if (content.certification_summary.certification_id !== identity.certification_id
    || content.certification_summary.generation_id !== identity.generation_id
    || String(content.certification_summary.artifact_sha256) !== artifact.sha256) {
    addPromotionIssue(context, ["dossier", "certification_summary"], "Certification summary identity must match current campaign evidence")
  }
  const campaignAttachment = state.attachments.find((attachment) => attachment.kind === "research-certification")
  if (campaignAttachment === undefined
    || JSON.stringify(content.certification_attachment) !== JSON.stringify(campaignAttachment)
    || JSON.stringify(content.certification_attachment) !== JSON.stringify(expectedAttachment)) {
    addPromotionIssue(context, ["dossier", "certification_attachment"], "Certification attachment must match the exact current campaign attachment")
  }
  const summary = content.certification_summary
  const expectedUncertainty = summary.attack_outcomes.inconclusive + summary.witness_outcomes.inconclusive
  const expectedEligibility = summary.witness_outcomes.confirmed === 0
    && summary.witness_outcomes.inconclusive === 0
    && summary.witness_outcomes.rejected === summary.attack_outcomes.counterexample_found
  if (summary.uncertainty_count !== expectedUncertainty || summary.approval_eligible !== expectedEligibility) {
    addPromotionIssue(context, ["dossier", "certification_summary"], "Certification summary eligibility and uncertainty must match visible outcomes")
  }
}
