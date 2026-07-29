import { z } from "zod"

export const WorkflowCheckpointPolicySchema = z.enum([
  "none",
  "after_solve",
  "after_review",
  "after_revise",
])

export type WorkflowCheckpointPolicy = z.infer<typeof WorkflowCheckpointPolicySchema>
