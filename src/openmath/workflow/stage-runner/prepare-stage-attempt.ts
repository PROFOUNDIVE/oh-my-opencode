import { renderReferenceBundle } from "../../references/renderer"
import type { WorkflowStateV1 } from "../state"
import type { WorkflowStage } from "../state/literals"
import { buildReviewStageInput } from "./build-review-stage-input"
import { buildReviseStageInput } from "./build-revise-stage-input"
import { buildSolveStageInput } from "./build-solve-stage-input"
import type { WorkflowStageInput } from "./stage-input"
import { referenceStageForWorkflowStage, roleForWorkflowStage } from "./stage-role"
import { sha256 } from "./sha256"

type RunningState = Extract<WorkflowStateV1, { readonly status: "RUNNING" }>
type PreparedAttempt = Extract<WorkflowStateV1["dispatch_attempts"][number], { readonly phase: "PREPARED" }>

export type PreparedStageAttempt = Readonly<{
  readonly attempt: PreparedAttempt
  readonly input: WorkflowStageInput
}>

export function prepareStageAttempt(input: Readonly<{
  readonly state: RunningState
  readonly workflow_input: string
}>): PreparedStageAttempt {
  const stage = input.state.next_stage
  const role = roleForWorkflowStage(input.state, stage)
  const referenceHash = renderReferenceBundle(input.state.reference_snapshot, referenceStageForWorkflowStage(stage)).sha256
  const artifactInputHash = sha256(input.state.artifact?.content ?? "")
  const profileHash = sha256(JSON.stringify(input.state.profile_snapshot))
  const promptHash = sha256(promptBytes(role.prompt))
  const attemptNumber = input.state.dispatch_attempts.filter((attempt) => (
    attempt.stage === stage && attempt.review_round === input.state.review_round
  )).length + 1
  const idempotencyKey = sha256([
    input.state.run_id,
    input.state.state_revision,
    stage,
    input.state.review_round,
    profileHash,
    referenceHash,
    artifactInputHash,
    attemptNumber,
  ].join("|"))

  return {
    attempt: {
      phase: "PREPARED",
      stage,
      role: role.agent,
      resolved_model: role.model,
      review_round: input.state.review_round,
      attempt_number: attemptNumber,
      state_revision: input.state.state_revision,
      idempotency_key: idempotencyKey,
      profile_hash: profileHash,
      prompt_hash: promptHash,
      reference_hash: referenceHash,
      artifact_input_hash: artifactInputHash,
      child_title: `[openmath:${idempotencyKey}] ${role.agent} ${input.state.run_id} round ${input.state.review_round}`,
    },
    input: buildInput(stage, input.state, input.workflow_input),
  }
}

function buildInput(stage: WorkflowStage, state: RunningState, workflowInput: string): WorkflowStageInput {
  switch (stage) {
    case "SOLVE":
      return buildSolveStageInput({ state, workflow_input: workflowInput })
    case "REVIEW":
      return buildReviewStageInput({ state, workflow_input: workflowInput })
    case "REVISE":
      return buildReviseStageInput({ state, workflow_input: workflowInput })
    default:
      return assertNever(stage)
  }
}

function promptBytes(prompt: RunningState["profile_snapshot"]["solve"]["prompt"]): string {
  switch (prompt.kind) {
    case "builtin":
      return "builtin"
    case "inline":
    case "file":
      return prompt.content
    default:
      return assertNever(prompt)
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected workflow stage: ${String(value)}`)
}
