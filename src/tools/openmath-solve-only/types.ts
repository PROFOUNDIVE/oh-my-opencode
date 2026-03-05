import { z } from "zod"

export const OpenMathSolveOnlyProblemSchema = z.object({
  id: z.string(),
  problem: z.string().optional(),
  prefix: z.string().optional(),
  problem_ref: z
    .object({
      file_path: z.string(),
      problem_number: z.number().int().min(1),
    })
    .optional(),
})

export const OpenMathSolveOnlyProblemInputSchema = OpenMathSolveOnlyProblemSchema.superRefine((val, ctx) => {
  const hasProblem = typeof val.problem === "string" && val.problem.trim().length > 0
  const hasProblemRef = Boolean(val.problem_ref)

  if (hasProblem === hasProblemRef) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Each problem must include exactly one of: problem or problem_ref",
    })
  }
})

export const OpenMathSolveOnlyInputSchema = z.object({
  session_id: z.string(),
  problems: z.array(OpenMathSolveOnlyProblemInputSchema).min(1),

  subject: z.string().optional(),
  chapter_context: z.string().optional(),
  textbook_markdown: z.string().optional(),
  supplementary_refs: z.array(z.string()).optional(),

  max_concurrency: z.number().int().min(1).optional(),
  max_review_rounds: z.number().int().min(1).max(20).optional(),

  auto_export: z.boolean().optional(),
  export_dir: z.string().optional(),
})

export const OpenMathSolveOnlyResultSchema = z.object({
  id: z.string(),
  session_id: z.string(),
  verdict: z.enum(["[CORRECT]", "[ERROR]", "[INCONCLUSIVE]"]).optional(),
  rounds_used: z.number().int().min(0),
  exported: z
    .object({
      student_path: z.string(),
      teacher_path: z.string(),
    })
    .optional(),
  error_code: z.string().optional(),
  message: z.string().optional(),
})

export const OpenMathSolveOnlySuccessSchema = z.object({
  ok: z.literal(true),
  results: z.array(OpenMathSolveOnlyResultSchema),
})

export type OpenMathSolveOnlyInput = z.infer<typeof OpenMathSolveOnlyInputSchema>
export type OpenMathSolveOnlyResult = z.infer<typeof OpenMathSolveOnlyResultSchema>
