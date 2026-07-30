import { z } from "zod"

import { WorkflowRequestV1Schema } from "../openmath-workflow-shared"

const NonBlankSchema = z.string().refine((value) => value.trim().length > 0)

export const OpenMathWorkflowStartToolKey = "openmath_workflow_start"

export const OpenMathWorkflowStartInputSchema = z.object({
  run_id: NonBlankSchema,
  request: WorkflowRequestV1Schema,
  workflow_profile: NonBlankSchema.optional(),
  reference_manifest_path: NonBlankSchema.optional(),
}).strict()

export type OpenMathWorkflowStartInput = z.infer<typeof OpenMathWorkflowStartInputSchema>
