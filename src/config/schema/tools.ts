import { z } from "zod"

export const OpenMathWorkflowToolNameSchema = z.enum([
  "openmath_workflow_start",
  "openmath_workflow_step",
  "openmath_workflow_status",
  "openmath_workflow_amend",
  "openmath_workflow_reload",
  "openmath_workflow_abort",
])

export const OpenMathResearchToolNameSchema = z.enum([
  "openmath_research_start",
  "openmath_research_status",
  "openmath_research_step",
  "openmath_research_amend",
  "openmath_research_promote",
  "openmath_research_educationalize",
  "openmath_research_abort",
])

export const DisabledToolNameSchema = z.union([
  OpenMathWorkflowToolNameSchema,
  OpenMathResearchToolNameSchema,
  z.string().refine((name) => (
    !name.startsWith("openmath_workflow_")
    && !name.startsWith("openmath_research_")
  )),
])

export type OpenMathWorkflowToolName = z.infer<typeof OpenMathWorkflowToolNameSchema>
export type OpenMathResearchToolName = z.infer<typeof OpenMathResearchToolNameSchema>
