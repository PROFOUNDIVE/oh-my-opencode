import { z } from "zod"

import { CampaignIdSchema, NonBlankSchema } from "../../openmath/research/state"
import { WorkflowRequestV1Schema } from "../openmath-workflow-shared"

export const OpenMathResearchStartToolKey = "openmath_research_start"

export const OpenMathResearchStartInputSchema = z.object({
  campaign_id: CampaignIdSchema,
  research_profile: NonBlankSchema.optional(),
  objective: WorkflowRequestV1Schema,
  reference_manifest_path: NonBlankSchema.optional(),
}).strict().readonly()

export type OpenMathResearchStartInput = z.infer<typeof OpenMathResearchStartInputSchema>
