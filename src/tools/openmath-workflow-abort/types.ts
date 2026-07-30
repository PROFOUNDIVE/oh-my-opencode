import { z } from "zod"

const NonBlankSchema = z.string().refine((value) => value.trim().length > 0)
export const OpenMathWorkflowAbortToolKey = "openmath_workflow_abort"

export const OpenMathWorkflowAbortInputSchema = z.object({
  run_id: NonBlankSchema,
  expected_state_revision: z.number().int().nonnegative(),
  reason: z.string().optional(),
}).strict()

export type OpenMathWorkflowAbortInput = z.infer<typeof OpenMathWorkflowAbortInputSchema>
