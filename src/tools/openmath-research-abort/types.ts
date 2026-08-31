import { z } from "zod"

import {
  CampaignIdSchema,
  CampaignRevisionSchema,
  NonBlankSchema,
} from "../../openmath/research/state"
import { CertificationRevisionSchema } from "../../openmath/research/certification/state/literals"

export const OpenMathResearchAbortToolKey = "openmath_research_abort"

export const OpenMathResearchPhaseAAbortInputSchema = z.object({
  campaign_id: CampaignIdSchema,
  expected_state_revision: CampaignRevisionSchema,
  reason: NonBlankSchema.optional(),
}).strict().readonly()

export const OpenMathResearchEnabledAbortInputSchema = z.object({
  campaign_id: CampaignIdSchema,
  expected_state_revision: CampaignRevisionSchema,
  expected_certification_revision: CertificationRevisionSchema.nullable(),
  reason: NonBlankSchema.optional(),
}).strict().readonly()

export const OpenMathResearchAbortInputSchema = z.union([
  OpenMathResearchPhaseAAbortInputSchema,
  OpenMathResearchEnabledAbortInputSchema,
])

export type OpenMathResearchAbortInput = z.infer<typeof OpenMathResearchAbortInputSchema>
