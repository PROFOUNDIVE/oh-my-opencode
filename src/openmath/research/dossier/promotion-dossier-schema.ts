import { z } from "zod"

import { ReviewDtoSchema } from "../../workflow/state"
import { OpaqueAttachmentReferencesSchema } from "../state/attachments"
import { CandidateArtifactReferenceSchema } from "../state/candidates"
import {
  CampaignHashSchema,
  CampaignIdSchema,
  CampaignRevisionSchema,
  CampaignSessionIdSchema,
  CandidateIdSchema,
  ChildRunIdSchema,
  NonBlankSchema,
} from "../state/literals"
import { ScreenReceiptSchema } from "../state/screens"
import { TournamentReceiptSchema } from "../state/tournaments"

const DossierIdSchema = z.string().regex(/^dossier-[a-z0-9]+(?:[._-][a-z0-9]+)*$/).max(136)

const LineageBaseSchema = z.object({
  candidate_id: CandidateIdSchema,
  created_at_revision: CampaignRevisionSchema,
  child_run_id: ChildRunIdSchema,
  parent_candidate_ids: z.array(CandidateIdSchema).readonly(),
})

export const PromotionCandidateLineageSchema = z.discriminatedUnion("candidate_kind", [
  LineageBaseSchema.extend({
    candidate_kind: z.literal("STRATEGY"),
    strategy_id: NonBlankSchema,
    strategy_ordinal: z.number().int().positive(),
  }).strict(),
  LineageBaseSchema.extend({
    candidate_kind: z.literal("MERGE_IDEA"),
    synthesis_brief: NonBlankSchema,
    synthesis_brief_sha256: CampaignHashSchema,
  }).strict(),
]).readonly()

export const ChildWorkflowReviewEvidenceSchema = z.object({
  child_run_id: ChildRunIdSchema,
  child_state_revision: CampaignRevisionSchema,
  status: z.literal("PASSED"),
  artifact_version: z.number().int().positive(),
  artifact_sha256: CampaignHashSchema,
  completed_review_rounds: z.number().int().positive(),
  consecutive_passes: z.number().int().positive(),
  latest_review: ReviewDtoSchema,
  review_history: z.array(ReviewDtoSchema).min(1).readonly(),
  final_review_session_id: CampaignSessionIdSchema,
  final_review_output_sha256: CampaignHashSchema,
}).strict().readonly()

const ScreenUncertaintiesSchema = z.object({
  screen_id: z.string(),
  values: z.array(z.string()).readonly(),
}).strict().readonly()

export const RemainingUncertaintiesSchema = z.object({
  blocking_issues: z.array(ScreenUncertaintiesSchema).readonly(),
  unresolved_obligations: z.array(ScreenUncertaintiesSchema).readonly(),
  assumptions: z.array(ScreenUncertaintiesSchema).readonly(),
}).strict().readonly()

export const PromotionDossierV1Schema = z.object({
  schema_version: z.literal(1),
  dossier_id: DossierIdSchema,
  campaign_id: CampaignIdSchema,
  created_at_revision: CampaignRevisionSchema,
  selected_artifact: CandidateArtifactReferenceSchema,
  objective_sha256: CampaignHashSchema,
  profile_sha256: CampaignHashSchema,
  reference_sha256: CampaignHashSchema,
  candidate_lineage: z.array(PromotionCandidateLineageSchema).min(1).readonly(),
  screen_receipts: z.array(ScreenReceiptSchema).min(1).readonly(),
  tournament_receipt: TournamentReceiptSchema,
  child_workflow_review_evidence: ChildWorkflowReviewEvidenceSchema,
  remaining_uncertainties: RemainingUncertaintiesSchema,
  attachments: OpaqueAttachmentReferencesSchema,
  canonical: z.literal(false),
  mathematical_correctness_certified: z.literal(false),
  human_approval_required: z.literal(true),
}).strict().readonly()

export type PromotionDossierV1 = z.infer<typeof PromotionDossierV1Schema>
