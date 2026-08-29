import { z } from "zod"

import { CampaignIdSchema, CampaignRevisionSchema } from "../../openmath/research/state"

export const OpenMathResearchStepToolKey = "openmath_research_step"

export const OpenMathResearchStepInputSchema = z.object({
  campaign_id: CampaignIdSchema,
  expected_state_revision: CampaignRevisionSchema,
  mode: z.enum(["one_stage", "to_checkpoint"]).optional(),
}).strict().readonly()

export type OpenMathResearchStepInput = z.infer<typeof OpenMathResearchStepInputSchema>
