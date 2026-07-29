import { buildStageInput } from "./build-stage-input"
import type { BuildWorkflowStageInput, WorkflowStageInput } from "./stage-input"

export function buildReviewStageInput(input: BuildWorkflowStageInput): WorkflowStageInput {
  return buildStageInput({
    ...input,
    stage: "REVIEW",
    required_checks: ["artifact_correctness", "reference_consistency"],
  })
}
