import { z } from "zod"

export const WorkflowCheckpointPolicySchema = z.enum([
  "none",
  "after_solve",
  "after_review",
  "every_stage",
])

export type WorkflowCheckpointPolicy = z.infer<typeof WorkflowCheckpointPolicySchema>
