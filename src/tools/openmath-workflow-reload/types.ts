import { z } from "zod"

const NonBlankSchema = z.string().refine((value) => value.trim().length > 0)
export const OpenMathWorkflowReloadToolKey = "openmath_workflow_reload"

export const OpenMathWorkflowReloadInputSchema = z.object({
  run_id: NonBlankSchema,
  expected_state_revision: z.number().int().nonnegative(),
  targets: z.array(z.enum(["prompts", "references"])).min(1).refine(
    (targets) => new Set(targets).size === targets.length,
    "Reload targets must be unique",
  ),
}).strict()

export type OpenMathWorkflowReloadInput = z.infer<typeof OpenMathWorkflowReloadInputSchema>
