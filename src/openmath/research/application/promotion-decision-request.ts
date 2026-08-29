import { z } from "zod"

import {
  CampaignHashSchema,
  CampaignIdSchema,
  CampaignRevisionSchema,
  CampaignSessionIdSchema,
  NonBlankSchema,
} from "../state"

export const PromotionDecisionRequestSchema = z.object({
  directory: NonBlankSchema,
  campaign_id: CampaignIdSchema,
  expected_state_revision: CampaignRevisionSchema,
  dossier_sha256: CampaignHashSchema,
  decision: z.enum(["approve", "reject"]),
}).strict().readonly()

export const TrustedPromotionActorReceiptSchema = z.object({
  session_id: CampaignSessionIdSchema,
  message_id: NonBlankSchema,
}).strict().readonly()

export type TrustedPromotionActorReceipt = z.input<typeof TrustedPromotionActorReceiptSchema>
