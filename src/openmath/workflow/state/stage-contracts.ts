import { z } from "zod"

import { ArtifactDtoSchema, LegacyReviewMetadataSchema, ReviewDtoSchema } from "./contracts"
import { HashSchema, WorkflowErrorCodeSchema, WorkflowStageSchema } from "./literals"
import { PatchApplyFailureSchema } from "../adapters/patch-apply-failure"

const NonBlankSchema = z.string().refine((value) => value.trim().length > 0)
const ModelSegmentSchema = z.string().regex(/^\S+$/)

export const ResolvedModelSchema = z.object({
  providerID: ModelSegmentSchema,
  modelID: ModelSegmentSchema,
  variant: NonBlankSchema.optional(),
}).strict()

const AdapterErrorBaseSchema = z.object({
  kind: z.literal("adapter_error"),
  message: NonBlankSchema,
  raw_output: z.string(),
})

const AdapterErrorSchema = z.discriminatedUnion("code", [
  AdapterErrorBaseSchema.extend({
    code: z.enum([
    "EMPTY_MARKDOWN",
    "INVALID_JSON",
    "INVALID_LEGACY_ARTIFACTS",
    "INVALID_LEGACY_SECTIONS",
    "INVALID_PATCH_SET",
    "MISSING_VERDICT",
    "DUPLICATE_VERDICT",
    "CONFLICTING_VERDICTS",
    "INVALID_REVIEW_VERDICT",
    ]),
  }).strict(),
  AdapterErrorBaseSchema.extend({
    code: z.literal("PATCH_APPLY_FAILED"),
    patch_failure: PatchApplyFailureSchema,
  }).strict(),
])

const AdapterStageErrorSchema = z.object({
  kind: z.literal("ERROR"),
  error_code: z.literal("ADAPTER_OUTPUT_INVALID"),
  message: NonBlankSchema,
  adapter_error: AdapterErrorSchema,
}).strict()

const NonAdapterStageErrorSchema = z.object({
  kind: z.literal("ERROR"),
  error_code: WorkflowErrorCodeSchema.exclude(["ADAPTER_OUTPUT_INVALID"]),
  message: NonBlankSchema,
}).strict()

const LegacyPatchTransportErrorSchema = z.object({
  kind: z.literal("ERROR"),
  error_code: z.literal("SUBAGENT_FAILED"),
  message: NonBlankSchema,
  legacy_failure: z.literal("SOLVER_PATCH_FAILED"),
}).strict()

export const ErrorStageReceiptSchema = z.union([
  AdapterStageErrorSchema,
  LegacyPatchTransportErrorSchema,
  NonAdapterStageErrorSchema,
])

const ReconciliationBlockedReceiptSchema = z.object({
  kind: z.literal("ERROR"),
  error_code: z.literal("RECONCILIATION_BLOCKED"),
  message: NonBlankSchema,
}).strict()

export const SuccessStageReceiptSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ARTIFACT"), artifact: ArtifactDtoSchema }).strict(),
  z.object({
    kind: z.literal("REVIEW"),
    review: ReviewDtoSchema,
    legacy_metadata: LegacyReviewMetadataSchema.optional(),
  }).strict(),
])

export const StageReceiptSchema = z.union([
  ...SuccessStageReceiptSchema.options,
  ErrorStageReceiptSchema,
])

const StageProvenanceSchema = z.object({
  stage: WorkflowStageSchema,
  role: NonBlankSchema,
  resolved_model: ResolvedModelSchema,
  review_round: z.number().int().positive(),
  profile_hash: HashSchema,
  prompt_hash: HashSchema,
  reference_hash: HashSchema,
})

const StageAttemptBaseSchema = StageProvenanceSchema.extend({
  attempt_number: z.number().int().positive(),
  state_revision: z.number().int().nonnegative(),
  idempotency_key: HashSchema,
  artifact_input_hash: HashSchema,
  child_title: NonBlankSchema,
})

export const StageAttemptSchema = z.discriminatedUnion("phase", [
  StageAttemptBaseSchema.extend({ phase: z.literal("PREPARED") }).strict(),
  StageAttemptBaseSchema.extend({
    phase: z.literal("SESSION_CREATED"),
    child_session_id: NonBlankSchema,
  }).strict(),
  StageAttemptBaseSchema.extend({
    phase: z.literal("PROMPT_SENT"),
    child_session_id: NonBlankSchema,
  }).strict(),
  StageAttemptBaseSchema.extend({
    phase: z.literal("COMPLETED"),
    child_session_id: NonBlankSchema,
    raw_output: z.string(),
    output_hash: HashSchema,
    receipt: StageReceiptSchema,
  }).strict(),
  StageAttemptBaseSchema.extend({
    phase: z.literal("COMMITTED"),
    child_session_id: NonBlankSchema,
    raw_output: z.string(),
    output_hash: HashSchema,
    receipt: StageReceiptSchema,
  }).strict(),
])

const StageRecordBaseSchema = StageProvenanceSchema.extend({
  artifact_version: z.number().int().positive(),
  state_revision: z.number().int().nonnegative(),
  attempt_key: HashSchema,
  input_hash: HashSchema,
})

export const StageRecordSchema = z.discriminatedUnion("outcome", [
  StageRecordBaseSchema.extend({
    outcome: z.literal("STARTED"),
    raw_session_id: NonBlankSchema.nullable(),
    raw_output: z.null(),
    output_hash: z.null(),
    parsed_result: z.null(),
    parsed_error: z.null(),
    error_code: z.null(),
  }).strict(),
  StageRecordBaseSchema.extend({
    outcome: z.literal("BLOCKED"),
    raw_session_id: NonBlankSchema.nullable(),
    raw_output: z.null(),
    output_hash: z.null(),
    parsed_result: z.null(),
    parsed_error: ReconciliationBlockedReceiptSchema,
    error_code: z.literal("RECONCILIATION_BLOCKED"),
  }).strict(),
  ...(["COMPLETED", "AWAITING_HUMAN", "ABORTED"] as const).map((outcome) => StageRecordBaseSchema.extend({
    outcome: z.literal(outcome),
    raw_session_id: NonBlankSchema,
    raw_output: z.string(),
    output_hash: HashSchema,
    parsed_result: SuccessStageReceiptSchema.nullable(),
    parsed_error: ErrorStageReceiptSchema.nullable(),
    error_code: WorkflowErrorCodeSchema.nullable(),
  }).strict()),
]).superRefine((record, context) => {
  if (record.outcome === "STARTED" || record.outcome === "BLOCKED") return
  if ((record.parsed_result === null) === (record.parsed_error === null)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["parsed_result"],
      message: "Completed stage records require exactly one parsed result or error",
    })
    return
  }
  const parsedCode = record.parsed_error?.error_code ?? null
  if (record.error_code !== parsedCode) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["error_code"],
      message: "Stage error_code must match its receipt",
    })
  }
})
