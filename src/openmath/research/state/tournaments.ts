import { z } from "zod"

import { ResolvedResearchModelSchema } from "./jobs"
import {
  CampaignHashSchema,
  CampaignJobIdSchema,
  CampaignRevisionSchema,
  CampaignSessionIdSchema,
  ScreenIdSchema,
  TournamentIdSchema,
} from "./literals"
import { TournamentResultSchema } from "./tournament-results"

export { TournamentActionSchema, TournamentResultSchema } from "./tournament-results"
export type { TournamentResult } from "./tournament-results"

export const TournamentReceiptSchema = z.object({
  tournament_id: TournamentIdSchema,
  job_id: CampaignJobIdSchema,
  campaign_revision: CampaignRevisionSchema,
  screen_ids: z.array(ScreenIdSchema).min(1).superRefine((ids, context) => {
    if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", message: "Tournament screen IDs must be unique" })
  }).readonly(),
  result: TournamentResultSchema,
  reviewer_session_id: CampaignSessionIdSchema,
  resolved_model: ResolvedResearchModelSchema,
  profile_sha256: CampaignHashSchema,
  prompt_sha256: CampaignHashSchema,
  reference_sha256: CampaignHashSchema,
  raw_output_sha256: CampaignHashSchema,
}).strict().readonly()

export type TournamentReceipt = z.infer<typeof TournamentReceiptSchema>
