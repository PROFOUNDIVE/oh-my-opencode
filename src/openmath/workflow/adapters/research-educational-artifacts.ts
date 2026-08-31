import { z } from "zod"

import { parseJsonOutput } from "./json-output-parser"
import type { AdapterResult } from "./types"

const NonBlankSchema = z.string().refine((value) => value.trim().length > 0)
export const REQUIRED_EDUCATIONAL_REVIEW_CHECKS = [
  "reference_solution_consistency",
  "hint_progression",
  "rubric_fidelity",
  "variant_validity",
  "uncertainty_fidelity",
] as const

export const ResearchEducationalArtifactsSchema = z.object({
  reference_solution: NonBlankSchema,
  hint_ladder: z.object({
    L1_nudge: NonBlankSchema,
    L2_key_theorem: NonBlankSchema,
    L3_skeleton: z.array(NonBlankSchema).min(1),
    L4_full_solution: z.literal("@REFERENCE_SOLUTION"),
  }).strict(),
  grading_rubric: z.object({
    premises_check: z.array(NonBlankSchema).min(1),
    logical_steps: z.array(NonBlankSchema).min(1),
    common_pitfalls: z.array(NonBlankSchema).min(1),
    key_theorem: NonBlankSchema,
    key_technique: NonBlankSchema,
  }).strict(),
  variant_problem: NonBlankSchema,
}).strict()

export const ResearchEducationalReviewSchema = z.object({
  verdict: z.enum(["PASS", "REVISE", "SOURCE_DEFECT"]),
  blocking_issues: z.array(NonBlankSchema).max(3),
  checks_performed: z.array(z.enum(REQUIRED_EDUCATIONAL_REVIEW_CHECKS)).min(1),
}).strict().superRefine((review, context) => {
  if (review.verdict === "PASS" && review.blocking_issues.length > 0) {
    context.addIssue({ code: "custom", path: ["blocking_issues"], message: "PASS cannot retain blocking issues" })
  }
  if (review.verdict === "PASS" && (
    review.checks_performed.length !== REQUIRED_EDUCATIONAL_REVIEW_CHECKS.length
    || REQUIRED_EDUCATIONAL_REVIEW_CHECKS.some((check) => !review.checks_performed.includes(check))
  )) {
    context.addIssue({ code: "custom", path: ["checks_performed"], message: "PASS requires every independent educational check exactly once" })
  }
  if (review.verdict !== "PASS" && review.blocking_issues.length === 0) {
    context.addIssue({ code: "custom", path: ["blocking_issues"], message: "Non-PASS review requires a blocking issue" })
  }
})

export function adaptResearchEducationalArtifacts(
  rawOutput: string,
  fixedReferenceSolution: string,
): AdapterResult {
  const parsed = parseJsonOutput(rawOutput)
  if (!parsed.ok) return adapterError("INVALID_JSON", "Educational artifact output is not valid JSON", rawOutput)
  const artifacts = ResearchEducationalArtifactsSchema.safeParse(parsed.value)
  if (!artifacts.success) {
    return adapterError(
      "INVALID_RESEARCH_EDUCATIONAL_ARTIFACTS",
      "Educational artifact output is malformed",
      rawOutput,
    )
  }
  if (artifacts.data.reference_solution !== fixedReferenceSolution) {
    return adapterError(
      "REFERENCE_SOLUTION_MUTATED",
      "Educational generation or revision attempted to mutate the approved reference solution",
      rawOutput,
    )
  }
  return {
    ok: true,
    kind: "legacy_json_artifacts",
    adapter: "research_educational_artifacts",
    artifacts: artifacts.data,
  }
}

export function adaptResearchEducationalReview(rawOutput: string): AdapterResult {
  const parsed = parseJsonOutput(rawOutput)
  if (!parsed.ok) return adapterError("INVALID_JSON", "Educational review output is not valid JSON", rawOutput)
  const review = ResearchEducationalReviewSchema.safeParse(parsed.value)
  if (!review.success) {
    return adapterError("INVALID_RESEARCH_EDUCATIONAL_REVIEW", "Educational review output is malformed", rawOutput)
  }
  return {
    ok: true,
    kind: "review",
    adapter: "research_educational_review_json",
    review: {
      verdict: review.data.verdict === "SOURCE_DEFECT" ? "INCONCLUSIVE" : review.data.verdict,
      raw_report: rawOutput,
      source_defect: review.data.verdict === "SOURCE_DEFECT",
      checks_performed: review.data.checks_performed,
    },
  }
}

function adapterError(
  code: "INVALID_JSON" | "INVALID_RESEARCH_EDUCATIONAL_ARTIFACTS" | "INVALID_RESEARCH_EDUCATIONAL_REVIEW" | "REFERENCE_SOLUTION_MUTATED",
  message: string,
  rawOutput: string,
): AdapterResult {
  return { ok: false, error: { kind: "adapter_error", code, message, raw_output: rawOutput } }
}
