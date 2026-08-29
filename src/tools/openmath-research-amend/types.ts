import { z } from "zod"

import {
  CampaignAmendmentScopeSchema,
  CampaignIdSchema,
  CampaignRevisionSchema,
  NonBlankSchema,
} from "../../openmath/research/state"

export const OpenMathResearchAmendToolKey = "openmath_research_amend"

export const OpenMathResearchAmendmentKindSchema = z.enum([
  "question",
  "required_check",
  "suspected_blocker",
  "scope_change",
])

export const OpenMathResearchAmendInputSchema = z.discriminatedUnion("operation", [
  z.object({
    campaign_id: CampaignIdSchema,
    expected_state_revision: CampaignRevisionSchema,
    operation: z.literal("add"),
    kind: OpenMathResearchAmendmentKindSchema,
    scope: CampaignAmendmentScopeSchema,
    content: NonBlankSchema,
  }).strict().readonly(),
  z.object({
    campaign_id: CampaignIdSchema,
    expected_state_revision: CampaignRevisionSchema,
    operation: z.literal("retract"),
    amendment_id: z.string().regex(/^amendment-[1-9][0-9]*$/),
  }).strict().readonly(),
])

export type OpenMathResearchAmendInput = z.infer<typeof OpenMathResearchAmendInputSchema>
