import { z } from "zod"

import { OpaqueAttachmentReferencesSchema } from "./attachments"
import { CandidateArtifactReferenceSchema } from "./candidates"
import {
  CampaignHashSchema,
  CampaignIdSchema,
  CampaignRevisionSchema,
  CampaignSessionIdSchema,
  CandidateIdSchema,
  NonBlankSchema,
} from "./literals"

export const PromotionDossierReferenceSchema = z.object({
  dossier_id: z.string().regex(/^dossier-[a-z0-9]+(?:[._-][a-z0-9]+)*$/).max(136),
  campaign_id: CampaignIdSchema,
  created_at_revision: CampaignRevisionSchema,
  selected_candidate_id: CandidateIdSchema,
  artifact: CandidateArtifactReferenceSchema,
  objective_sha256: CampaignHashSchema,
  profile_sha256: CampaignHashSchema,
  reference_sha256: CampaignHashSchema,
  serialized_bytes: NonBlankSchema,
  content_sha256: CampaignHashSchema,
  storage_ref: NonBlankSchema,
  attachments: OpaqueAttachmentReferencesSchema,
}).strict().readonly()

export const PromotionDecisionReceiptSchema = z.object({
  campaign_id: CampaignIdSchema,
  campaign_revision: CampaignRevisionSchema,
  state_revision: CampaignRevisionSchema,
  dossier_sha256: CampaignHashSchema,
  decision: z.enum(["approve", "reject"]),
  actor_session_id: CampaignSessionIdSchema,
  actor_message_id: NonBlankSchema,
}).strict().readonly()

export type PromotionDossierReference = z.infer<typeof PromotionDossierReferenceSchema>
export type PromotionDecisionReceipt = z.infer<typeof PromotionDecisionReceiptSchema>
