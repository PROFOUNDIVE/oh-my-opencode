import { z } from "zod"

import { OpaqueAttachmentReferencesSchema } from "./attachments"
import { CandidateArtifactReferenceSchema } from "./candidates"
import { ResolvedResearchModelSchema } from "./jobs"
import {
  CampaignHashSchema,
  CampaignJobIdSchema,
  CampaignRevisionSchema,
  CampaignSessionIdSchema,
  CandidateIdSchema,
  ScreenIdSchema,
} from "./literals"
import { ScreenNormalizedOutputShape } from "./screen-normalized-output"

export const ScreenReceiptSchema = z.object({
  screen_id: ScreenIdSchema,
  job_id: CampaignJobIdSchema,
  campaign_revision: CampaignRevisionSchema,
  candidate_id: CandidateIdSchema,
  artifact: CandidateArtifactReferenceSchema,
  screen_role: z.string().refine((value) => value.trim().length > 0),
  ...ScreenNormalizedOutputShape,
  reviewer_session_id: CampaignSessionIdSchema,
  resolved_model: ResolvedResearchModelSchema,
  profile_sha256: CampaignHashSchema,
  prompt_sha256: CampaignHashSchema,
  reference_sha256: CampaignHashSchema,
  raw_output_sha256: CampaignHashSchema,
  attachments: OpaqueAttachmentReferencesSchema,
}).strict().readonly()

export type ScreenReceipt = z.infer<typeof ScreenReceiptSchema>
