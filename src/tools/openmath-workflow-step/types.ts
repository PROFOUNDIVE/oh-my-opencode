import { z } from "zod"

const NonBlankSchema = z.string().refine((value) => value.trim().length > 0)

export const OpenMathWorkflowStepToolKey = "openmath_workflow_step"

export const OpenMathWorkflowStepInputSchema = z.object({
  run_id: NonBlankSchema,
  expected_state_revision: z.number().int().nonnegative(),
  mode: z.enum(["one_stage", "to_checkpoint"]).optional(),
}).strict()

export type OpenMathWorkflowStepInput = z.infer<typeof OpenMathWorkflowStepInputSchema>
