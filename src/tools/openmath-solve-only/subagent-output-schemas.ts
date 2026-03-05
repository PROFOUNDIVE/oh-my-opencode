import { z } from "zod"

import { ReviewVerdictSchema } from "../openmath-state/types"
import { OpenMathArtifactsPatchSetSchema } from "../../openmath/artifacts-patch/types"

export const SolverArtifactsSchema = z.object({
  reference_solution: z.string(),
  hint_ladder: z.record(z.string(), z.unknown()),
  grading_rubric: z.record(z.string(), z.unknown()),
  variant_problem: z.string(),
})

export const ReviewerCertificateInputSchema = z.object({
  artifact_version: z.string(),
  review_round: z.number(),
  timestamp: z.string(),
  notes: z.string().optional(),
})

export const ReviewerJsonOutputSchema = z.object({
  verdict: ReviewVerdictSchema,
  certificate: ReviewerCertificateInputSchema,
})

export const ReviewerPatchOutputSchema = z.object({
  verdict: ReviewVerdictSchema,
  certificate: ReviewerCertificateInputSchema,
  base_hash: z.string(),
  patch_set: OpenMathArtifactsPatchSetSchema,
})

export const ReviewerBlockingIssueSchema = z.object({
  location: z.string(),
  type: z.enum([
    "logic_error",
    "missing_condition",
    "invalid_citation",
    "python_mismatch",
    "lean_mismatch",
    "spec_violation",
  ]),
  fix_direction: z.string(),
  evidence: z.string(),
})

export const ReviewerMarkdownOutputSchema = z.object({
  verdict: ReviewVerdictSchema,
  blocking_issues: z.array(ReviewerBlockingIssueSchema).max(3),
  checks_performed: z.array(z.enum(["logic", "citation", "spec", "python_optional", "lean4_optional"])),
  certificate: ReviewerCertificateInputSchema,
  base_hash: z.string(),
})
