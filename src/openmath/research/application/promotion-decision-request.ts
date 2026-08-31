import { z } from "zod"

import {
  CampaignHashSchema,
  CampaignIdSchema,
  CampaignRevisionSchema,
  CampaignSessionIdSchema,
  NonBlankSchema,
} from "../state"
import { CertificationRevisionSchema } from "../certification/state/literals"

export const PromotionDecisionRequestSchema = z.object({
  directory: NonBlankSchema,
  campaign_id: CampaignIdSchema,
  expected_state_revision: CampaignRevisionSchema,
  dossier_sha256: CampaignHashSchema,
  decision: z.enum(["approve", "reject"]),
}).strict().readonly()

export const EnabledPromotionDecisionRequestSchema = z.object({
  directory: NonBlankSchema,
  campaign_id: CampaignIdSchema,
  expected_state_revision: CampaignRevisionSchema,
  expected_certification_revision: CertificationRevisionSchema,
  dossier_sha256: CampaignHashSchema,
  decision: z.enum(["approve", "reject"]),
}).strict().readonly()

export const TrustedPromotionActorReceiptSchema = z.object({
  session_id: CampaignSessionIdSchema,
  message_id: NonBlankSchema,
}).strict().readonly()

export type TrustedPromotionActorReceipt = z.input<typeof TrustedPromotionActorReceiptSchema>
