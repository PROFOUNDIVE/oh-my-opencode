import { z } from "zod"

import { AmendmentHistorySchema } from "./amendment-history"
import { ArtifactDtoSchema, ReviewDtoSchema } from "./contracts"
import { AwaitingReasonSchema, HashSchema, WorkflowStageSchema } from "./literals"
import { ReferenceSnapshotSchema, WorkflowProfileSnapshotSchema } from "./snapshots"
import { StageAttemptSchema, StageRecordSchema } from "./stage-contracts"

const NonBlankSchema = z.string().refine((value) => value.trim().length > 0)

const LegacyProjectionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z.object({
    kind: z.literal("solve_only"),
    schema_version: z.literal(1),
    session_id: NonBlankSchema,
    original_problem_text: z.string().nullable(),
    artifact_state: z.enum(["DRAFT", "FROZEN", "UNFROZEN"]),
    max_review_rounds: z.number().int().positive(),
    hint_budget_state: z.object({
      hints_used: z.number().int().nonnegative(),
      hint_budget: z.number().int().nonnegative(),
    }).strict(),
  }).strict(),
])

const WorkflowStateCoreSchema = z.object({
  schema_version: z.literal(1),
  run_id: NonBlankSchema,
  state_revision: z.number().int().nonnegative(),
  parent_session_id: NonBlankSchema,
  intervention_satisfied: z.boolean(),
  review_round: z.number().int().positive(),
  completed_review_rounds: z.number().int().nonnegative(),
  consecutive_passes: z.number().int().nonnegative(),
  artifact_version: z.number().int().positive(),
  profile_snapshot: WorkflowProfileSnapshotSchema,
  reference_snapshot: ReferenceSnapshotSchema,
  artifact: ArtifactDtoSchema.nullable(),
  latest_review: ReviewDtoSchema.nullable(),
  review_history: z.array(ReviewDtoSchema),
  amendments: AmendmentHistorySchema,
  stage_history: z.array(StageRecordSchema),
  dispatch_attempts: z.array(StageAttemptSchema),
  legacy_projection: LegacyProjectionSchema,
  legacy_source_hash: HashSchema.nullable(),
})

const IdleStatusFields = {
  next_stage: WorkflowStageSchema,
  awaiting_reason: z.null(),
  abort_requested: z.literal(false),
  abort_reason: z.null(),
  blocked_reason: z.null(),
}
const TerminalStatusFields = {
  next_stage: z.null(),
  awaiting_reason: z.null(),
  abort_requested: z.literal(false),
  abort_reason: z.null(),
  blocked_reason: z.null(),
}

export const WorkflowStateV1Schema = z.discriminatedUnion("status", [
  WorkflowStateCoreSchema.extend({ status: z.literal("READY"), ...IdleStatusFields }).strict(),
  WorkflowStateCoreSchema.extend({
    status: z.literal("RUNNING"),
    next_stage: WorkflowStageSchema,
    awaiting_reason: z.null(),
    abort_requested: z.boolean(),
    abort_reason: z.string().nullable(),
    blocked_reason: z.null(),
  }).strict(),
  WorkflowStateCoreSchema.extend({
    status: z.literal("AWAITING_HUMAN"),
    next_stage: WorkflowStageSchema,
    awaiting_reason: AwaitingReasonSchema,
    abort_requested: z.literal(false),
    abort_reason: z.null(),
    blocked_reason: z.null(),
  }).strict(),
  WorkflowStateCoreSchema.extend({ status: z.literal("PASSED"), ...TerminalStatusFields }).strict(),
  WorkflowStateCoreSchema.extend({ status: z.literal("EXHAUSTED"), ...TerminalStatusFields }).strict(),
  WorkflowStateCoreSchema.extend({
    status: z.literal("ABORTED"),
    next_stage: z.null(),
    awaiting_reason: z.null(),
    abort_requested: z.literal(true),
    abort_reason: z.string().nullable(),
    blocked_reason: z.null(),
  }).strict(),
  WorkflowStateCoreSchema.extend({
    status: z.literal("BLOCKED"),
    next_stage: WorkflowStageSchema,
    awaiting_reason: z.null(),
    abort_requested: z.literal(false),
    abort_reason: z.null(),
    blocked_reason: NonBlankSchema,
  }).strict(),
]).superRefine((state, context) => {
  if (state.abort_requested === false && state.abort_reason !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["abort_reason"], message: "Abort reason requires abort_requested" })
  }
  if ((state.next_stage === "REVIEW" || state.next_stage === "REVISE") && state.artifact === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["artifact"], message: `${state.next_stage} requires an artifact` })
  }
  if (state.next_stage === "SOLVE" && state.artifact !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["artifact"], message: "SOLVE requires no artifact" })
  }
  if (state.awaiting_reason === "INCONCLUSIVE" && state.next_stage !== "REVIEW") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["next_stage"], message: "INCONCLUSIVE resumes at REVIEW" })
  }
  if (state.status === "PASSED" && state.artifact === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["artifact"], message: "PASSED requires an artifact" })
  }
  if (state.artifact !== null && state.artifact.version !== state.artifact_version) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["artifact_version"], message: "Artifact version must match ArtifactDto.version" })
  }
  if (state.completed_review_rounds > state.review_round) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["completed_review_rounds"], message: "Completed reviews exceed review progression" })
  }
  if (state.consecutive_passes > state.completed_review_rounds) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["consecutive_passes"], message: "Consecutive passes exceed completed reviews" })
  }
  if (state.status === "PASSED") {
    if (state.latest_review?.verdict !== "PASS") {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["latest_review"], message: "PASSED requires latest PASS evidence" })
    }
    if (state.completed_review_rounds < state.profile_snapshot.min_review_rounds) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["completed_review_rounds"], message: "PASSED requires minimum completed reviews" })
    }
    if (state.consecutive_passes < state.profile_snapshot.required_consecutive_passes) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["consecutive_passes"], message: "PASSED requires consecutive pass threshold" })
    }
  }
  for (const [index, event] of state.amendments.entries()) {
    if (event.state_revision > state.state_revision) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["amendments", index, "state_revision"], message: "Amendment revision exceeds state revision" })
    }
  }
})

export type WorkflowStateV1 = Readonly<z.infer<typeof WorkflowStateV1Schema>>
