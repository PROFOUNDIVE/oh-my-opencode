import { z } from "zod"

export const OpenMathWorkflowToolNameSchema = z.enum([
  "openmath_workflow_start",
  "openmath_workflow_step",
  "openmath_workflow_status",
  "openmath_workflow_amend",
  "openmath_workflow_reload",
  "openmath_workflow_abort",
])

export const DisabledToolNameSchema = z.union([
  OpenMathWorkflowToolNameSchema,
  z.string().refine((name) => !name.startsWith("openmath_workflow_")),
])

export type OpenMathWorkflowToolName = z.infer<typeof OpenMathWorkflowToolNameSchema>
