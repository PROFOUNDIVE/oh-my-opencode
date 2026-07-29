import { z } from "zod"

export const WorkflowReviewRoundSchema = z.number().int().min(1)

export const WorkflowStopPolicySchema = z.object({
  min_review_rounds: WorkflowReviewRoundSchema,
  max_review_rounds: WorkflowReviewRoundSchema,
  required_consecutive_passes: WorkflowReviewRoundSchema,
}).strict().superRefine((policy, context) => {
  const issue = getWorkflowStopPolicyIssue(policy)
  if (issue) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: [issue.field],
      message: issue.message,
    })
  }
})

export type WorkflowStopPolicy = z.infer<typeof WorkflowStopPolicySchema>

export function getWorkflowStopPolicyIssue(
  policy: WorkflowStopPolicy,
): { readonly field: "min_review_rounds" | "required_consecutive_passes"; readonly message: string } | undefined {
  if (policy.min_review_rounds > policy.max_review_rounds) {
    return {
      field: "min_review_rounds",
      message: "min_review_rounds must not exceed max_review_rounds",
    }
  }
  if (policy.required_consecutive_passes > policy.max_review_rounds) {
    return {
      field: "required_consecutive_passes",
      message: "required_consecutive_passes must not exceed max_review_rounds",
    }
  }
  return undefined
}
