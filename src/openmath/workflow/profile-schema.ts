import { z } from "zod"

import {
  isWorkflowAdapterAllowed,
  workflowAdapterRoleMessage,
  type WorkflowStageName,
} from "./adapters"
import { WorkflowCheckpointPolicySchema } from "./checkpoint-policy"
import { WorkflowRoleSettingsSchema } from "./role-settings"
import {
  getWorkflowStopPolicyIssue,
  WorkflowReviewRoundSchema,
  type WorkflowStopPolicy,
} from "./stop-policy"

export const WorkflowProfileNameSchema = z.string().regex(/^[a-z][a-z0-9-]*$/, {
  message: "Workflow profile names must use lowercase letters, numbers, and hyphens",
})

export const WorkflowProfileSchema = z.object({
  solve: WorkflowRoleSettingsSchema,
  review: WorkflowRoleSettingsSchema,
  revise: WorkflowRoleSettingsSchema,
  min_review_rounds: WorkflowReviewRoundSchema,
  max_review_rounds: WorkflowReviewRoundSchema,
  required_consecutive_passes: WorkflowReviewRoundSchema,
  checkpoint: WorkflowCheckpointPolicySchema,
}).strict().superRefine((profile, context) => {
  const stopIssue = getWorkflowStopPolicyIssue(profile)
  if (stopIssue) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: [stopIssue.field],
      message: stopIssue.message,
    })
  }

  const stages: readonly WorkflowStageName[] = ["solve", "review", "revise"]
  for (const stage of stages) {
    const role = profile[stage]
    if (!isWorkflowAdapterAllowed(stage, role.output_adapter)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [stage, "output_adapter"],
        message: workflowAdapterRoleMessage(stage),
      })
    }
  }
})

export const WorkflowProfilesSchema = z.record(z.string(), WorkflowProfileSchema).superRefine((profiles, context) => {
  for (const name of Object.keys(profiles)) {
    const result = WorkflowProfileNameSchema.safeParse(name)
    if (!result.success) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [name],
        message: "Workflow profile names must use lowercase letters, numbers, and hyphens",
      })
    }
  }
})

export type WorkflowProfile = z.infer<typeof WorkflowProfileSchema>
export type WorkflowProfiles = z.infer<typeof WorkflowProfilesSchema>
export type WorkflowProfileStopPolicy = WorkflowStopPolicy
