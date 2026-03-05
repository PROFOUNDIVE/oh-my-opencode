import { z } from "zod"

export const ArtifactStateSchema = z.enum(["DRAFT", "FROZEN", "UNFROZEN"])

export const ReviewVerdictSchema = z.enum(["[CORRECT]", "[ERROR]", "[INCONCLUSIVE]"])

export const ReviewCertificateSchema = z.object({
  artifact_version: z.string(),
  review_round: z.number(),
  timestamp: z.string(),
  verdict: ReviewVerdictSchema,
  notes: z.string().optional(),
})

export const FrozenArtifactsSchema = z.object({
  reference_solution: z.string(),
  hint_ladder: z.record(z.string(), z.unknown()),
  grading_rubric: z.record(z.string(), z.unknown()),
  variant_problem: z.string(),
  review_certificate: ReviewCertificateSchema,
})

export const HintBudgetStateSchema = z.object({
  hints_used: z.number(),
  hint_budget: z.number(),
})

export const OpenMathSessionStateSchema = z.object({
  session_id: z.string(),
  artifact_state: ArtifactStateSchema,
  artifact_version: z.number(),
  review_round: z.number(),
  max_review_rounds: z.number(),
  hint_budget_state: HintBudgetStateSchema,
  frozen_artifacts: FrozenArtifactsSchema.nullable(),
})

export const OpenMathStateGetInputSchema = z.object({
  session_id: z.string(),
  init_if_missing: z.boolean().optional(),
})

export const OpenMathStateSetInputSchema = z.object({
  state: OpenMathSessionStateSchema,
})

export const OpenMathStateResetInputSchema = z.object({
  session_id: z.string(),
})

export type OpenMathStateGetInput = z.infer<typeof OpenMathStateGetInputSchema>
export type OpenMathStateSetInput = z.infer<typeof OpenMathStateSetInputSchema>
export type OpenMathStateResetInput = z.infer<typeof OpenMathStateResetInputSchema>
