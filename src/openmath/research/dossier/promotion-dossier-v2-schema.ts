import { z } from "zod"

import { CertificationSummaryV1Schema } from "../certification/state/summary"
import { OpaqueAttachmentReferenceSchema } from "../state/attachments"
import { PromotionDossierV1Schema } from "./promotion-dossier-schema"

const AttachmentShape = OpaqueAttachmentReferenceSchema.unwrap().shape
const V1Shape = PromotionDossierV1Schema.unwrap().shape

export const PromotionCertificationAttachmentSchema = z.object({
  attachment_id: AttachmentShape.attachment_id,
  kind: z.literal("research-certification"),
  schema_version: z.literal(1),
  content_sha256: AttachmentShape.content_sha256,
  storage_ref: AttachmentShape.storage_ref,
}).strict().readonly()

export const PromotionDossierV2Schema = z.object({
  schema_version: z.literal(2),
  dossier_id: V1Shape.dossier_id,
  campaign_id: V1Shape.campaign_id,
  created_at_revision: V1Shape.created_at_revision,
  selected_artifact: V1Shape.selected_artifact,
  objective_sha256: V1Shape.objective_sha256,
  profile_sha256: V1Shape.profile_sha256,
  reference_sha256: V1Shape.reference_sha256,
  candidate_lineage: V1Shape.candidate_lineage,
  screen_receipts: V1Shape.screen_receipts,
  tournament_receipt: V1Shape.tournament_receipt,
  child_workflow_review_evidence: V1Shape.child_workflow_review_evidence,
  remaining_uncertainties: V1Shape.remaining_uncertainties,
  certification_summary: CertificationSummaryV1Schema,
  certification_attachment: PromotionCertificationAttachmentSchema,
  attachments: V1Shape.attachments,
  canonical: V1Shape.canonical,
  mathematical_correctness_certified: V1Shape.mathematical_correctness_certified,
  human_approval_required: V1Shape.human_approval_required,
}).strict().superRefine((dossier, context) => {
  const matches = dossier.attachments.filter((attachment) => (
    attachment.attachment_id === dossier.certification_attachment.attachment_id
      && JSON.stringify(attachment) === JSON.stringify(dossier.certification_attachment)
  ))
  if (matches.length !== 1) {
    context.addIssue({
      code: "custom",
      path: ["certification_attachment"],
      message: "Certification attachment must appear exactly once in attachments",
    })
  }
}).readonly()

export type PromotionDossierV2 = z.infer<typeof PromotionDossierV2Schema>
