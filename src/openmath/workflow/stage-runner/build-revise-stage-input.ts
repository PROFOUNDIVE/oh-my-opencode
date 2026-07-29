import { buildStageInput } from "./build-stage-input"
import type { BuildWorkflowStageInput, WorkflowStageInput } from "./stage-input"

export function buildReviseStageInput(input: BuildWorkflowStageInput): WorkflowStageInput {
  return buildStageInput({
    ...input,
    stage: "REVISE",
    required_checks: ["blocking_issue_resolution", "reference_consistency"],
  })
}
