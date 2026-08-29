import { z } from "zod"

import { CampaignAmendmentHistorySchema } from "./amendments"
import { OpaqueAttachmentReferencesSchema } from "./attachments"
import { CandidateDescriptorSchema } from "./candidates"
import { CampaignJobAttemptSchema } from "./jobs"
import {
  CampaignIdSchema,
  CampaignJobIdSchema,
  CampaignPhaseSchema,
  CampaignRevisionSchema,
  CampaignSessionIdSchema,
  CandidateIdSchema,
  NonBlankSchema,
  ResearchAwaitingReasonSchema,
} from "./literals"
import { PromotionDecisionReceiptSchema, PromotionDossierReferenceSchema } from "./promotion-references"
import { ScreenReceiptSchema } from "./screens"
import { ResearchCampaignSourceSnapshotSchema } from "./source-snapshots"
import { validateCampaignStatusInvariants } from "./status-invariants"
import { TournamentReceiptSchema } from "./tournaments"
import { validateCampaignIdentityInvariants } from "./identity-invariants"
import { validateCampaignPromotionInvariants } from "./promotion-invariants"
import { validateCampaignRevisionInvariants } from "./revision-invariants"
import { validateCampaignHashInvariants } from "./hash-invariants"
import { validateAttachmentIdentityInvariants } from "./attachment-identity-invariants"

const ResearchCampaignCoreSchema = z.object({
  schema_version: z.literal(1),
  campaign_id: CampaignIdSchema,
  parent_session_id: CampaignSessionIdSchema,
  state_revision: CampaignRevisionSchema,
  phase: CampaignPhaseSchema,
  source_snapshot: ResearchCampaignSourceSnapshotSchema,
  candidates: z.array(CandidateDescriptorSchema).readonly(),
  job_attempts: z.array(CampaignJobAttemptSchema).readonly(),
  screen_receipts: z.array(ScreenReceiptSchema).readonly(),
  tournament_receipts: z.array(TournamentReceiptSchema).readonly(),
  amendments: CampaignAmendmentHistorySchema,
  selected_candidate_id: CandidateIdSchema.nullable(),
  dossier: PromotionDossierReferenceSchema.nullable(),
  decision_receipt: PromotionDecisionReceiptSchema.nullable(),
  attachments: OpaqueAttachmentReferencesSchema,
})

const NoContinuationFields = {
  awaiting_reason: z.null(),
  abort_requested: z.literal(false),
  abort_reason: z.null(),
  blocked_reason: z.null(),
  active_job_ids: z.array(CampaignJobIdSchema).length(0).readonly(),
}

export const ResearchCampaignStateV1Schema = z.discriminatedUnion("status", [
  ResearchCampaignCoreSchema.extend({ status: z.literal("READY"), ...NoContinuationFields }).strict(),
  ResearchCampaignCoreSchema.extend({
    status: z.literal("RUNNING"),
    awaiting_reason: z.null(),
    abort_requested: z.boolean(),
    abort_reason: NonBlankSchema.nullable(),
    blocked_reason: z.null(),
    active_job_ids: z.array(CampaignJobIdSchema).min(1).superRefine((ids, context) => {
      if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", message: "Active job IDs must be unique" })
    }).readonly(),
  }).strict(),
  ResearchCampaignCoreSchema.extend({
    status: z.literal("AWAITING_HUMAN"),
    awaiting_reason: ResearchAwaitingReasonSchema,
    abort_requested: z.literal(false),
    abort_reason: z.null(),
    blocked_reason: z.null(),
    active_job_ids: z.array(CampaignJobIdSchema).length(0).readonly(),
  }).strict(),
  ResearchCampaignCoreSchema.extend({
    status: z.literal("BLOCKED"),
    awaiting_reason: z.null(),
    abort_requested: z.literal(false),
    abort_reason: z.null(),
    blocked_reason: NonBlankSchema,
    active_job_ids: z.array(CampaignJobIdSchema).length(0).readonly(),
  }).strict(),
  ResearchCampaignCoreSchema.extend({ status: z.literal("PROMOTION_READY"), ...NoContinuationFields }).strict(),
  ResearchCampaignCoreSchema.extend({ status: z.literal("REJECTED"), ...NoContinuationFields }).strict(),
  ResearchCampaignCoreSchema.extend({
    status: z.literal("ABORTED"),
    awaiting_reason: z.null(),
    abort_requested: z.literal(true),
    abort_reason: NonBlankSchema.nullable(),
    blocked_reason: z.null(),
    active_job_ids: z.array(CampaignJobIdSchema).length(0).readonly(),
  }).strict(),
]).superRefine((state, context) => {
  validateCampaignStatusInvariants(state, context)
  validateCampaignIdentityInvariants(state, context)
  validateCampaignRevisionInvariants(state, context)
  validateCampaignPromotionInvariants(state, context)
  validateCampaignHashInvariants(state, context)
  validateAttachmentIdentityInvariants(state, context)
}).readonly()

export type ResearchCampaignStateV1 = z.infer<typeof ResearchCampaignStateV1Schema>
