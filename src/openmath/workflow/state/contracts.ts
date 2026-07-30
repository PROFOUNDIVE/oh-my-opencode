import { z } from "zod"

import { JsonObjectSchema, JsonValueSchema } from "./json-value"
import { HashSchema } from "./literals"

export const ArtifactDtoSchema = z.object({
  version: z.number().int().positive(),
  media_type: z.enum(["text/markdown", "application/vnd.openmath.legacy+json"]),
  content: z.string(),
  sha256: HashSchema,
}).strict()

export const ReviewDtoSchema = z.object({
  round: z.number().int().positive(),
  verdict: z.enum(["PASS", "REVISE", "INCONCLUSIVE"]),
  raw_report: z.string(),
  raw_report_sha256: HashSchema,
  findings: z.array(z.object({
    code: z.string(),
    message: z.string(),
    location: z.string().nullable(),
  }).strict()),
  checks_performed: z.array(z.string()),
  session_id: z.string().min(1),
  prompt_hash: HashSchema,
  reference_hash: HashSchema,
  artifact_input_hash: HashSchema,
}).strict()

export const LegacyReviewMetadataSchema = z.object({
  certificate: z.object({
    artifact_version: z.string(),
    review_round: z.number().int().positive(),
    timestamp: z.string(),
    notes: z.string().optional(),
  }).strict(),
  blocking_issues: z.array(JsonValueSchema).optional(),
}).strict()

export type LegacyReviewMetadata = Readonly<z.infer<typeof LegacyReviewMetadataSchema>>

export const AmendmentEventSchema = z.discriminatedUnion("event_type", [
  z.object({
    event_type: z.literal("ADDED"),
    amendment_id: z.string().regex(/^amendment-[0-9]+$/),
    kind: z.enum(["question", "required_check", "suspected_blocker", "scope_change"]),
    scope: z.union([z.literal("next_review"), z.literal("all_remaining"), z.string().regex(/^round:[1-9][0-9]*$/)]),
    content: z.string().min(1),
    lifecycle: z.literal("ACTIVE"),
    state_revision: z.number().int().nonnegative(),
  }).strict(),
  z.object({
    event_type: z.literal("RETRACTED"),
    amendment_id: z.string().regex(/^amendment-[0-9]+$/),
    lifecycle: z.literal("RETRACTED"),
    state_revision: z.number().int().nonnegative(),
  }).strict(),
  z.object({
    event_type: z.literal("CONSUMED"),
    amendment_id: z.string().regex(/^amendment-[0-9]+$/),
    lifecycle: z.literal("ACTIVE"),
    state_revision: z.number().int().nonnegative(),
  }).strict(),
])

export const LegacyFrozenArtifactsSchema = z.object({
  reference_solution: z.string(),
  hint_ladder: JsonObjectSchema,
  grading_rubric: JsonObjectSchema,
  variant_problem: z.string(),
  review_certificate: z.object({
    artifact_version: z.string(),
    review_round: z.number().int().positive(),
    timestamp: z.string(),
    verdict: z.enum(["[CORRECT]", "[ERROR]", "[INCONCLUSIVE]"]),
    notes: z.string().optional(),
  }).strict(),
}).strict()
