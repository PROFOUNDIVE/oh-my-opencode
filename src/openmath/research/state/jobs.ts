import { z } from "zod"

import {
  CampaignHashSchema,
  CampaignJobIdSchema,
  CampaignRevisionSchema,
  CampaignSessionIdSchema,
  CandidateIdSchema,
  NonBlankSchema,
  ScreenIdSchema,
  TournamentIdSchema,
} from "./literals"
import { ScreenNormalizedOutputSchema } from "./screen-normalized-output"
import { TournamentResultSchema } from "./tournament-results"
import { CandidateArtifactReferenceSchema } from "./candidates"

export const ResolvedResearchModelSchema = z.object({
  providerID: z.string().regex(/^\S+$/),
  modelID: z.string().regex(/^\S+$/),
  variant: NonBlankSchema.optional(),
}).strict().readonly()

export const CampaignJobTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("CANDIDATE"), candidate_id: CandidateIdSchema }).strict(),
  z.object({
    kind: z.literal("SCREEN"),
    screen_id: ScreenIdSchema,
    candidate_id: CandidateIdSchema,
  }).strict(),
  z.object({ kind: z.literal("TOURNAMENT"), tournament_id: TournamentIdSchema }).strict(),
]).readonly()

export const CampaignJobReceiptSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("CANDIDATE_ARTIFACT"),
    candidate_id: CandidateIdSchema,
    artifact_sha256: CampaignHashSchema,
    predecessor_artifact: CandidateArtifactReferenceSchema.optional(),
    refined_artifact: CandidateArtifactReferenceSchema.optional(),
  }).strict(),
  z.object({
    kind: z.literal("SCREEN"),
    screen_id: ScreenIdSchema,
    normalized_output: ScreenNormalizedOutputSchema.optional(),
  }).strict(),
  z.object({
    kind: z.literal("TOURNAMENT"),
    tournament_id: TournamentIdSchema,
    result: TournamentResultSchema.optional(),
  }).strict(),
  z.object({
    kind: z.literal("ERROR"),
    error_code: NonBlankSchema,
    message: NonBlankSchema,
  }).strict(),
]).readonly()

const CampaignJobBaseSchema = z.object({
  job_id: CampaignJobIdSchema,
  target: CampaignJobTargetSchema,
  attempt_number: z.number().int().positive(),
  prepared_at_revision: CampaignRevisionSchema,
  phase_revision: CampaignRevisionSchema,
  idempotency_key: CampaignHashSchema,
  role: NonBlankSchema,
  resolved_model: ResolvedResearchModelSchema,
  profile_sha256: CampaignHashSchema,
  prompt_sha256: CampaignHashSchema,
  reference_sha256: CampaignHashSchema,
  input_sha256: CampaignHashSchema,
  child_title: NonBlankSchema,
})

const CompletedJobFields = {
  child_session_id: CampaignSessionIdSchema,
  raw_output_sha256: CampaignHashSchema,
  receipt: CampaignJobReceiptSchema,
}

export const CampaignJobAttemptSchema = z.discriminatedUnion("phase", [
  CampaignJobBaseSchema.extend({ phase: z.literal("PREPARED") }).strict(),
  CampaignJobBaseSchema.extend({
    phase: z.literal("SESSION_CREATED"),
    child_session_id: CampaignSessionIdSchema,
  }).strict(),
  CampaignJobBaseSchema.extend({
    phase: z.literal("PROMPT_SENT"),
    child_session_id: CampaignSessionIdSchema,
  }).strict(),
  CampaignJobBaseSchema.extend({ phase: z.literal("COMPLETED"), ...CompletedJobFields }).strict(),
  CampaignJobBaseSchema.extend({ phase: z.literal("COMMITTED"), ...CompletedJobFields }).strict(),
]).superRefine((attempt, context) => {
  if (attempt.phase_revision < attempt.prepared_at_revision) {
    context.addIssue({ code: "custom", path: ["phase_revision"], message: "Job phase revision cannot precede preparation" })
  }
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
  target: z.infer<typeof CampaignJobTargetSchema>,
  receipt: z.infer<typeof CampaignJobReceiptSchema>,
  context: z.RefinementCtx,
): void {
  switch (receipt.kind) {
    case "ERROR":
      return
    case "CANDIDATE_ARTIFACT":
      if (target.kind !== "CANDIDATE" || target.candidate_id !== receipt.candidate_id) {
        context.addIssue({ code: "custom", path: ["receipt"], message: "Candidate receipt must match its job target" })
      }
      return
    case "SCREEN":
      if (target.kind !== "SCREEN" || target.screen_id !== receipt.screen_id) {
        context.addIssue({ code: "custom", path: ["receipt"], message: "Screen receipt must match its job target" })
      }
      return
    case "TOURNAMENT":
      if (target.kind !== "TOURNAMENT" || target.tournament_id !== receipt.tournament_id) {
        context.addIssue({ code: "custom", path: ["receipt"], message: "Tournament receipt must match its job target" })
      }
      return
    default:
      assertNever(receipt)
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected campaign job variant: ${String(value)}`)
}

export type CampaignJobAttempt = z.infer<typeof CampaignJobAttemptSchema>
