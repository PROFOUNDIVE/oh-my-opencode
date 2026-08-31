import { z } from "zod"

import {
  CampaignHashSchema,
  CampaignIdSchema,
  CampaignRevisionSchema,
} from "../../openmath/research/state"
import { CertificationRevisionSchema } from "../../openmath/research/certification/state/literals"

export const OpenMathResearchPromoteToolKey = "openmath_research_promote"

export const OpenMathResearchPhaseAPromoteInputSchema = z.object({
  campaign_id: CampaignIdSchema,
  expected_state_revision: CampaignRevisionSchema,
  dossier_sha256: CampaignHashSchema,
  decision: z.enum(["approve", "reject"]),
}).strict().readonly()

export const OpenMathResearchEnabledPromoteInputSchema = z.object({
  campaign_id: CampaignIdSchema,
  expected_state_revision: CampaignRevisionSchema,
  expected_certification_revision: CertificationRevisionSchema,
  dossier_sha256: CampaignHashSchema,
  decision: z.enum(["approve", "reject"]),
}).strict().readonly()

export const OpenMathResearchPromoteInputSchema = z.union([
  OpenMathResearchPhaseAPromoteInputSchema,
  OpenMathResearchEnabledPromoteInputSchema,
])

export type OpenMathResearchPromoteInput = z.infer<typeof OpenMathResearchPromoteInputSchema>
