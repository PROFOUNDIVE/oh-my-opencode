import { buildStageInput } from "./build-stage-input"
import type { BuildWorkflowStageInput, WorkflowStageInput } from "./stage-input"

export function buildSolveStageInput(input: BuildWorkflowStageInput): WorkflowStageInput {
  return buildStageInput({
    ...input,
    stage: "SOLVE",
    required_checks: ["artifact_correctness", "reference_consistency"],
  })
}
