import { z } from "zod"

export const OpenMathWorkflowNonBlankSchema = z.string().regex(/\S/, "Value must not be blank")
export const OpenMathWorkflowAmendmentScopeSchema = z.union([z.literal("next_review"), z.literal("all_remaining"), z.string().regex(/^round:[1-9][0-9]*$/)])
export const OpenMathWorkflowAmendToolKey = "openmath_workflow_amend"
const BaseSchema = z.object({ run_id: OpenMathWorkflowNonBlankSchema, expected_state_revision: z.number().int().nonnegative() })

export const OpenMathWorkflowAmendInputSchema = z.discriminatedUnion("operation", [
  BaseSchema.extend({
    operation: z.literal("add"),
    kind: z.enum(["question", "required_check", "suspected_blocker", "scope_change"]),
    scope: OpenMathWorkflowAmendmentScopeSchema,
    content: OpenMathWorkflowNonBlankSchema,
  }).strict(),
  BaseSchema.extend({ operation: z.literal("retract"), amendment_id: OpenMathWorkflowNonBlankSchema }).strict(),
])

export type OpenMathWorkflowAmendInput = z.infer<typeof OpenMathWorkflowAmendInputSchema>
