import { z } from "zod"

import { WorkflowAdapterNameSchema } from "./adapters"
import { PromptSourceSchema } from "./prompt-source"

const NonBlankStringSchema = z.string().refine((value) => value.trim().length > 0, {
  message: "Value must not be blank",
})

export const WorkflowModelStringSchema = z.string().refine((value) => parseWorkflowModelString(value) !== undefined, {
  message: "model must use nonblank provider/model segments",
})

export function parseWorkflowModelString(
  value: string,
): { readonly providerID: string; readonly modelID: string } | undefined {
  const segments = value.split("/")
  const providerID = segments[0]
  const modelID = segments[1]
  if (
    segments.length !== 2
    || providerID === undefined
    || modelID === undefined
    || providerID.length === 0
    || modelID.length === 0
    || /\s/.test(providerID)
    || /\s/.test(modelID)
  ) {
    return undefined
  }
  return { providerID, modelID }
}

export const WorkflowRoleSettingsSchema = z.object({
  agent: NonBlankStringSchema,
  model: WorkflowModelStringSchema.optional(),
  variant: NonBlankStringSchema.optional(),
  prompt: PromptSourceSchema,
  output_adapter: WorkflowAdapterNameSchema,
}).strict().superRefine((role, context) => {
  if (role.variant !== undefined && role.model === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["variant"],
      message: "variant requires an explicit model",
    })
  }
})

export type WorkflowRoleSettings = z.infer<typeof WorkflowRoleSettingsSchema>
