import { z } from "zod"

import {
  CampaignHashSchema,
  CampaignIdSchema,
  CampaignRevisionSchema,
} from "../../openmath/research/state"

export const OpenMathResearchPromoteToolKey = "openmath_research_promote"

export const OpenMathResearchPromoteInputSchema = z.object({
  campaign_id: CampaignIdSchema,
  expected_state_revision: CampaignRevisionSchema,
  dossier_sha256: CampaignHashSchema,
  decision: z.enum(["approve", "reject"]),
}).strict().readonly()

export type OpenMathResearchPromoteInput = z.infer<typeof OpenMathResearchPromoteInputSchema>
