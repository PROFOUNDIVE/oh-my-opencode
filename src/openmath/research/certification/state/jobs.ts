import { z } from "zod"

import { sha256 } from "../../../workflow/stage-runner/sha256"
import { CampaignIdSchema } from "../../state/literals"
import { CertificationAttackModeSchema } from "./attacks"
import { CertificationResolvedModelSchema } from "./model-provenance"
import {
  AttackAttemptIdSchema,
  CertificationGenerationIdSchema,
  CertificationIdSchema,
  CertificationJobIdSchema,
  CertificationRevisionSchema,
  CertificationSessionIdSchema,
  CertificationSha256Schema,
  CoverageReviewIdSchema,
  NonBlankSchema,
  ObligationIdSchema,
  WitnessVerificationIdSchema,
} from "./literals"

const ArtifactTargetFields = {
  artifact_sha256: CertificationSha256Schema,
}
const GraphTargetFields = {
  ...ArtifactTargetFields,
  graph_sha256: CertificationSha256Schema,
}

export const CertificationJobTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("EXTRACTION"), coverage_round: z.number().int().positive().max(5), ...ArtifactTargetFields }).strict(),
  z.object({
    kind: z.literal("COVERAGE"),
    coverage_review_id: CoverageReviewIdSchema,
    coverage_round: z.number().int().positive().max(5),
    ...GraphTargetFields,
  }).strict(),
  z.object({
    kind: z.literal("ATTACK"),
    attack_attempt_id: AttackAttemptIdSchema,
    obligation_id: ObligationIdSchema,
    node_sha256: CertificationSha256Schema,
    mode: CertificationAttackModeSchema,
    ordinal: z.number().int().positive(),
    ...GraphTargetFields,
  }).strict(),
  z.object({
    kind: z.literal("WITNESS"),
    witness_verification_id: WitnessVerificationIdSchema,
    attack_attempt_id: AttackAttemptIdSchema,
    obligation_id: ObligationIdSchema,
    node_sha256: CertificationSha256Schema,
    witness_sha256: CertificationSha256Schema,
    ...GraphTargetFields,
  }).strict(),
]).readonly()

export const CertificationJobOperationalErrorCodeSchema = z.enum([
  "ADAPTER_OUTPUT_INVALID",
  "DISPATCH_FAILED",
  "STALE_OUTPUT",
])

export const CertificationJobReceiptSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("EXTRACTION"), graph_sha256: CertificationSha256Schema }).strict(),
  z.object({ kind: z.literal("COVERAGE"), coverage_review_id: CoverageReviewIdSchema }).strict(),
  z.object({ kind: z.literal("ATTACK"), attack_attempt_id: AttackAttemptIdSchema }).strict(),
  z.object({ kind: z.literal("WITNESS"), witness_verification_id: WitnessVerificationIdSchema }).strict(),
  z.object({ kind: z.literal("ERROR"), error_code: CertificationJobOperationalErrorCodeSchema, message: NonBlankSchema }).strict(),
]).readonly()

const CertificationJobBaseSchema = z.object({
  job_id: CertificationJobIdSchema,
  job_kind: z.enum(["EXTRACTION", "COVERAGE", "ATTACK", "WITNESS"]),
  certification_id: CertificationIdSchema,
  generation_id: CertificationGenerationIdSchema,
  campaign_id: CampaignIdSchema,
  target: CertificationJobTargetSchema,
  attempt_number: z.number().int().positive(),
  prepared_at_revision: CertificationRevisionSchema,
  phase_revision: CertificationRevisionSchema,
  idempotency_key: CertificationSha256Schema,
  role: NonBlankSchema,
  resolved_model: CertificationResolvedModelSchema,
  certification_profile_sha256: CertificationSha256Schema,
  prompt_sha256: CertificationSha256Schema,
  reference_sha256: CertificationSha256Schema,
  input_sha256: CertificationSha256Schema,
  child_title: NonBlankSchema,
})

const CompletedFields = {
  child_session_id: CertificationSessionIdSchema,
  raw_output_sha256: CertificationSha256Schema,
  receipt: CertificationJobReceiptSchema,
}

export const CertificationJobAttemptSchema = z.discriminatedUnion("phase", [
  CertificationJobBaseSchema.extend({ phase: z.literal("PREPARED") }).strict(),
  CertificationJobBaseSchema.extend({ phase: z.literal("SESSION_CREATED"), child_session_id: CertificationSessionIdSchema }).strict(),
  CertificationJobBaseSchema.extend({ phase: z.literal("PROMPT_SENT"), child_session_id: CertificationSessionIdSchema }).strict(),
  CertificationJobBaseSchema.extend({ phase: z.literal("COMPLETED"), ...CompletedFields }).strict(),
  CertificationJobBaseSchema.extend({ phase: z.literal("COMMITTED"), ...CompletedFields }).strict(),
]).superRefine((attempt, context) => {
  if (attempt.phase_revision < attempt.prepared_at_revision) context.addIssue({ code: "custom", path: ["phase_revision"], message: "Job phase cannot precede preparation" })
  if (attempt.job_kind !== attempt.target.kind) context.addIssue({ code: "custom", path: ["job_kind"], message: "Job kind must match target" })
  switch (attempt.phase) {
    case "PREPARED":
    case "SESSION_CREATED":
    case "PROMPT_SENT":
      return
    case "COMPLETED":
    case "COMMITTED":
      validateReceiptTarget(attempt.target, attempt.receipt, context)
      return
    default:
      assertNever(attempt)
  }
}).readonly()

function validateReceiptTarget(
  target: z.infer<typeof CertificationJobTargetSchema>,
  receipt: z.infer<typeof CertificationJobReceiptSchema>,
  context: z.RefinementCtx,
): void {
  if (receipt.kind === "ERROR") return
  if (receipt.kind !== target.kind) {
    context.addIssue({ code: "custom", path: ["receipt"], message: "Certification receipt kind must match target" })
    return
  }
  switch (receipt.kind) {
    case "EXTRACTION":
      return
    case "COVERAGE":
      if (target.kind !== "COVERAGE" || receipt.coverage_review_id !== target.coverage_review_id) addMismatch(context)
      return
    case "ATTACK":
      if (target.kind !== "ATTACK" || receipt.attack_attempt_id !== target.attack_attempt_id) addMismatch(context)
      return
    case "WITNESS":
      if (target.kind !== "WITNESS" || receipt.witness_verification_id !== target.witness_verification_id) addMismatch(context)
      return
    default:
      assertNever(receipt)
  }
}

export function hashCertificationJob(attempt: z.infer<typeof CertificationJobAttemptSchema>): string {
  return sha256(JSON.stringify(attempt))
}

function addMismatch(context: z.RefinementCtx): void {
  context.addIssue({ code: "custom", path: ["receipt"], message: "Certification receipt must match exact target identity" })
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected certification job variant: ${String(value)}`)
}

export type CertificationJobAttempt = z.infer<typeof CertificationJobAttemptSchema>
export type CertificationJobOperationalErrorCode = z.infer<typeof CertificationJobOperationalErrorCodeSchema>
