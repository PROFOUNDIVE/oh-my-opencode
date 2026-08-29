import { z } from "zod"

import { CampaignIdSchema } from "../../openmath/research/state"

export const OpenMathResearchStatusToolKey = "openmath_research_status"

export const OpenMathResearchStatusInputSchema = z.object({
  campaign_id: CampaignIdSchema,
}).strict().readonly()

export type OpenMathResearchStatusInput = z.infer<typeof OpenMathResearchStatusInputSchema>
