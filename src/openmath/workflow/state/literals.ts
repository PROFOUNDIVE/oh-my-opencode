import { z } from "zod"

export const WorkflowStatusSchema = z.enum([
  "READY",
  "RUNNING",
  "AWAITING_HUMAN",
  "PASSED",
  "EXHAUSTED",
  "ABORTED",
  "BLOCKED",
])

export const WorkflowStageSchema = z.enum(["SOLVE", "REVIEW", "REVISE"])

export const AwaitingReasonSchema = z.enum(["CHECKPOINT", "INCONCLUSIVE", "PARSE_FAILURE"])

export const WorkflowErrorCodeSchema = z.enum([
  "VALIDATION_ERROR",
  "RUN_NOT_FOUND",
  "RUN_ALREADY_EXISTS",
  "PROFILE_NOT_FOUND",
  "ILLEGAL_TRANSITION",
  "STALE_STATE_REVISION",
  "PROMPT_SOURCE_ERROR",
  "REFERENCE_SOURCE_ERROR",
  "ADAPTER_OUTPUT_INVALID",
  "STORAGE_READ_FAILED",
  "STORAGE_WRITE_FAILED",
  "STORAGE_BUSY",
  "STORAGE_ATOMICITY_UNAVAILABLE",
  "SUBAGENT_FAILED",
  "RECONCILIATION_BLOCKED",
  "CAMPAIGN_NOT_APPROVED",
  "DOSSIER_HASH_MISMATCH",
  "CERTIFICATION_SOURCE_MISMATCH",
  "SELECTED_ARTIFACT_MISMATCH",
  "SOURCE_IDENTITY_MISMATCH",
  "ABORTED",
])

export const AmendmentKindSchema = z.enum([
  "question",
  "required_check",
  "suspected_blocker",
  "scope_change",
])

export const AmendmentScopeSchema = z.union([
  z.literal("next_review"),
  z.literal("all_remaining"),
  z.string().regex(/^round:[1-9][0-9]*$/),
])

export const AmendmentLifecycleSchema = z.enum(["ACTIVE", "RETRACTED"])

export const HashSchema = z.string().regex(/^[a-f0-9]{64}$/)

export type WorkflowStatus = z.infer<typeof WorkflowStatusSchema>
export type WorkflowStage = z.infer<typeof WorkflowStageSchema>
export type AwaitingReason = z.infer<typeof AwaitingReasonSchema>
export type WorkflowErrorCode = z.infer<typeof WorkflowErrorCodeSchema>
