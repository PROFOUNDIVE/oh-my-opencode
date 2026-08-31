import { z } from "zod"

import { CertificationRevisionSchema } from "../../openmath/research/certification/state/literals"
import { CampaignHashSchema, CampaignIdSchema, CampaignRevisionSchema } from "../../openmath/research/state"

export const OpenMathResearchEducationalizeInputSchema = z.object({
  campaign_id: CampaignIdSchema,
  expected_state_revision: CampaignRevisionSchema,
  expected_certification_revision: CertificationRevisionSchema,
  dossier_sha256: CampaignHashSchema,
}).strict()
