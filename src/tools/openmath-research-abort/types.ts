import { z } from "zod"

import {
  CampaignIdSchema,
  CampaignRevisionSchema,
  NonBlankSchema,
} from "../../openmath/research/state"

export const OpenMathResearchAbortToolKey = "openmath_research_abort"

export const OpenMathResearchAbortInputSchema = z.object({
  campaign_id: CampaignIdSchema,
  expected_state_revision: CampaignRevisionSchema,
  reason: NonBlankSchema.optional(),
}).strict().readonly()

export type OpenMathResearchAbortInput = z.infer<typeof OpenMathResearchAbortInputSchema>
