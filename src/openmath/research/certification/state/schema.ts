import { z } from "zod"

import { sha256 } from "../../../workflow/stage-runner/sha256"
import { CampaignIdSchema } from "../../state/literals"
import { CertificationAmendmentHistorySchema } from "./amendments"
import { AttackAttemptSchema } from "./attacks"
import { CoverageReviewSchema } from "./coverage"
import { EvidenceReceiptV1Schema } from "./evidence"
import { CertificationFinalizationSchema } from "./finalization"
import { CertificationGraphSchema } from "./graph"
import { CertificationSelectedArtifactSchema } from "./identity"
import { validateCertificationJobsAndEvidence } from "./job-evidence-invariants"
import { CertificationJobAttemptSchema } from "./jobs"
import {
  CertificationBlockedReasonSchema,
  CertificationGenerationIdSchema,
  CertificationIdSchema,
  CertificationJobIdSchema,
  CertificationRevisionSchema,
  CertificationSha256Schema,
  NonBlankSchema,
} from "./literals"
import { validateCertificationRecords } from "./record-invariants"
import { validateCertificationRevisions } from "./revision-invariants"
import { CertificationSummaryV1Schema } from "./summary"
import { validateCertificationSummary } from "./summary-invariants"
import { WitnessVerificationSchema } from "./witnesses"

const NonterminalPhaseSchema = z.enum(["EXTRACTION", "COVERAGE_REVIEW", "COUNTEREXAMPLE_ATTACK", "WITNESS_VERIFICATION"])

const CertificationIdentitySchema = z.object({
  schema_version: z.literal(1),
  certification_id: CertificationIdSchema,
  generation_id: CertificationGenerationIdSchema,
  campaign_id: CampaignIdSchema,
  selected_artifact: CertificationSelectedArtifactSchema,
  objective_sha256: CertificationSha256Schema,
  profile_sha256: CertificationSha256Schema,
  reference_sha256: CertificationSha256Schema,
  certification_profile_sha256: CertificationSha256Schema,
  certification_revision: CertificationRevisionSchema,
})

const CertificationRecordFields = {
  graphs: z.array(CertificationGraphSchema).readonly(),
  coverage_reviews: z.array(CoverageReviewSchema).readonly(),
  attack_attempts: z.array(AttackAttemptSchema).readonly(),
  witness_verifications: z.array(WitnessVerificationSchema).readonly(),
  evidence_receipts: z.array(EvidenceReceiptV1Schema).readonly(),
  amendments: CertificationAmendmentHistorySchema,
  job_attempts: z.array(CertificationJobAttemptSchema).readonly(),
}

const EmptyContinuationFields = {
  awaiting_reason: z.null(),
  abort_requested: z.literal(false),
  abort_reason: z.null(),
  blocked_reason: z.null(),
  active_job_ids: z.array(CertificationJobIdSchema).length(0).readonly(),
}

export const ResearchCertificationStateV1Schema = z.discriminatedUnion("status", [
  CertificationIdentitySchema.extend({
    phase: NonterminalPhaseSchema,
    status: z.literal("READY"),
    ...EmptyContinuationFields,
    ...CertificationRecordFields,
    summary: z.null(),
    finalization: z.null(),
  }).strict(),
  CertificationIdentitySchema.extend({
    phase: NonterminalPhaseSchema,
    status: z.literal("RUNNING"),
    awaiting_reason: z.null(),
    abort_requested: z.boolean(),
    abort_reason: NonBlankSchema.nullable(),
    blocked_reason: z.null(),
    active_job_ids: z.array(CertificationJobIdSchema).min(1).readonly(),
    ...CertificationRecordFields,
    summary: z.null(),
    finalization: z.null(),
  }).strict(),
  CertificationIdentitySchema.extend({
    phase: z.enum(["EXTRACTION", "COVERAGE_REVIEW"]),
    status: z.literal("AWAITING_HUMAN"),
    awaiting_reason: z.literal("COVERAGE_REVIEW_REQUIRED"),
    abort_requested: z.literal(false),
    abort_reason: z.null(),
    blocked_reason: z.null(),
    active_job_ids: z.array(CertificationJobIdSchema).length(0).readonly(),
    ...CertificationRecordFields,
    summary: z.null(),
    finalization: z.null(),
  }).strict(),
  CertificationIdentitySchema.extend({
    phase: NonterminalPhaseSchema,
    status: z.literal("BLOCKED"),
    awaiting_reason: z.null(),
    abort_requested: z.literal(false),
    abort_reason: z.null(),
    blocked_reason: CertificationBlockedReasonSchema,
    active_job_ids: z.array(CertificationJobIdSchema).length(0).readonly(),
    ...CertificationRecordFields,
    summary: z.null(),
    finalization: z.null(),
  }).strict(),
  CertificationIdentitySchema.extend({
    phase: NonterminalPhaseSchema,
    status: z.literal("ABORTED"),
    awaiting_reason: z.null(),
    abort_requested: z.literal(true),
    abort_reason: NonBlankSchema.nullable(),
    blocked_reason: z.null(),
    active_job_ids: z.array(CertificationJobIdSchema).length(0).readonly(),
    ...CertificationRecordFields,
    summary: z.null(),
    finalization: z.null(),
  }).strict(),
  CertificationIdentitySchema.extend({
    phase: z.literal("COMPLETE"),
    status: z.literal("COMPLETE"),
    awaiting_reason: z.null(),
    abort_requested: z.literal(false),
    abort_reason: z.null(),
    blocked_reason: z.null(),
    active_job_ids: z.array(CertificationJobIdSchema).length(0).readonly(),
    ...CertificationRecordFields,
    summary: CertificationSummaryV1Schema,
    finalization: CertificationFinalizationSchema,
  }).strict(),
]).superRefine((state, context) => {
  if (state.status === "RUNNING" && !state.abort_requested && state.abort_reason !== null) context.addIssue({ code: "custom", path: ["abort_reason"], message: "Abort reason requires abort request" })
  validateCertificationRecords(state, context)
  validateCertificationJobsAndEvidence(state, context)
  validateCertificationRevisions(state, context)
  validateCertificationSummary(state, context)
}).readonly()

export function hashResearchCertificationState(state: z.infer<typeof ResearchCertificationStateV1Schema>): string {
  return sha256(JSON.stringify(state))
}

export type ResearchCertificationStateV1 = z.infer<typeof ResearchCertificationStateV1Schema>
