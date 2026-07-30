import { z } from "zod"

export const OpenMathWorkflowStatusToolKey = "openmath_workflow_status"

export const OpenMathWorkflowStatusInputSchema = z.object({
  run_id: z.string().refine((value) => value.trim().length > 0),
}).strict()

export type OpenMathWorkflowStatusInput = z.infer<typeof OpenMathWorkflowStatusInputSchema>
