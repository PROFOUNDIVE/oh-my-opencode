import { renderReferenceBundle } from "../../references/renderer"
import type { WorkflowStage } from "../state/literals"
import { renderApplicableAmendments } from "../transitions"
import type { BuildWorkflowStageInput, WorkflowStageInput } from "./stage-input"
import { referenceStageForWorkflowStage, roleForWorkflowStage } from "./stage-role"

type StagePromptInput = BuildWorkflowStageInput & Readonly<{
  readonly stage: WorkflowStage
  readonly required_checks: readonly string[]
}>

export function buildStageInput(input: StagePromptInput): WorkflowStageInput {
  const role = roleForWorkflowStage(input.state, input.stage)
  const referenceBundle = renderReferenceBundle(input.state.reference_snapshot, referenceStageForWorkflowStage(input.stage))
  return {
    system_content: promptContent(role.prompt),
    user_prompt: JSON.stringify({
      stage: input.stage,
      workflow_input: input.workflow_input,
      role_prompt: role.prompt,
      reference_bundle: {
        stage: referenceBundle.stage,
        sha256: referenceBundle.sha256,
        content: referenceBundle.content,
      },
      artifact_input: input.state.artifact,
      amendments: renderApplicableAmendments(input.state, input.stage),
      review_policy: {
        min_review_rounds: input.state.profile_snapshot.min_review_rounds,
        max_review_rounds: input.state.profile_snapshot.max_review_rounds,
        required_consecutive_passes: input.state.profile_snapshot.required_consecutive_passes,
      },
      required_checks: input.required_checks,
    }),
  }
}

function promptContent(prompt: BuildWorkflowStageInput["state"]["profile_snapshot"]["solve"]["prompt"]): string | undefined {
  switch (prompt.kind) {
    case "builtin":
      return undefined
    case "inline":
    case "file":
      return prompt.content
    default:
      return assertNever(prompt)
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected workflow stage value: ${String(value)}`)
}
