import { z } from "zod"

import { CampaignIdSchema, CampaignRevisionSchema } from "../../openmath/research/state"
import { CertificationRevisionSchema } from "../../openmath/research/certification/state/literals"

export const OpenMathResearchStepToolKey = "openmath_research_step"

export const OpenMathResearchPhaseAStepInputSchema = z.object({
  campaign_id: CampaignIdSchema,
  expected_state_revision: CampaignRevisionSchema,
  mode: z.enum(["one_stage", "to_checkpoint"]).optional(),
}).strict().readonly()

export const OpenMathResearchEnabledStepInputSchema = z.object({
  campaign_id: CampaignIdSchema,
  expected_state_revision: CampaignRevisionSchema,
  expected_certification_revision: CertificationRevisionSchema.nullable(),
  mode: z.enum(["one_stage", "to_checkpoint"]).optional(),
}).strict().readonly()

export const OpenMathResearchStepInputSchema = z.union([
  OpenMathResearchPhaseAStepInputSchema,
  OpenMathResearchEnabledStepInputSchema,
])

export type OpenMathResearchStepInput = z.infer<typeof OpenMathResearchStepInputSchema>
