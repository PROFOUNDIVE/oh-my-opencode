import { WorkflowStateV1Schema, type WorkflowStateV1 } from "../state"
import { createWorkflowStateFixture } from "../state/test-fixture"

const HASH = "b".repeat(64)

type CompletedAttempt = Extract<WorkflowStateV1["dispatch_attempts"][number], { readonly phase: "COMPLETED" }>
export type StageReceipt = CompletedAttempt["receipt"]

export function artifact(version = 1) {
  return {
    version,
    media_type: "text/markdown" as const,
    content: `artifact-${version}`,
    sha256: HASH,
  }
}

export function review(round: number, verdict: "PASS" | "REVISE" | "INCONCLUSIVE") {
  return {
    round,
    verdict,
    raw_report: verdict,
    raw_report_sha256: HASH,
    findings: [],
    checks_performed: ["proof"],
    session_id: `review-${round}`,
    prompt_hash: HASH,
    reference_hash: HASH,
    artifact_input_hash: HASH,
  }
}

export function workflowState(overrides: Record<string, unknown> = {}): WorkflowStateV1 {
  return WorkflowStateV1Schema.parse({
    ...createWorkflowStateFixture(),
    state_revision: 0,
    status: "READY",
    next_stage: "SOLVE",
    awaiting_reason: null,
    abort_requested: false,
    abort_reason: null,
    blocked_reason: null,
    intervention_satisfied: false,
    review_round: 1,
    completed_review_rounds: 0,
    consecutive_passes: 0,
    artifact_version: 1,
    artifact: null,
    latest_review: null,
    review_history: [],
    amendments: [],
    stage_history: [],
    dispatch_attempts: [],
    legacy_projection: { kind: "none" },
    ...overrides,
  })
}

export function withPolicy(
  state: WorkflowStateV1,
  policy: {
    readonly checkpoint?: "none" | "after_solve" | "after_review" | "every_stage"
    readonly min_review_rounds?: number
    readonly max_review_rounds?: number
    readonly required_consecutive_passes?: number
  },
): WorkflowStateV1 {
  return WorkflowStateV1Schema.parse({
    ...state,
    profile_snapshot: { ...state.profile_snapshot, ...policy },
  })
}

export function runningWithReceipt(
  state: WorkflowStateV1,
  stage: "SOLVE" | "REVIEW" | "REVISE",
  receipt: StageReceipt,
): WorkflowStateV1 {
  const artifactInput = stage === "SOLVE" ? null : state.artifact ?? artifact()
  const role = roleForStage(state, stage)
  const attempt: CompletedAttempt = {
    phase: "COMPLETED",
    stage,
    role: role.agent,
    resolved_model: role.model,
    review_round: state.review_round,
    attempt_number: 1,
    state_revision: state.state_revision,
    idempotency_key: HASH,
    profile_hash: HASH,
    prompt_hash: HASH,
    reference_hash: HASH,
    artifact_input_hash: HASH,
    child_title: `[openmath:${HASH}] role run round ${state.review_round}`,
    child_session_id: `child-${stage.toLowerCase()}`,
    raw_output: receipt.kind,
    output_hash: HASH,
    receipt,
  }
  return WorkflowStateV1Schema.parse({
    ...state,
    status: "RUNNING",
    next_stage: stage,
    awaiting_reason: null,
    abort_requested: false,
    abort_reason: null,
    blocked_reason: null,
    artifact: artifactInput,
    dispatch_attempts: [...state.dispatch_attempts, attempt],
  })
}

function roleForStage(state: WorkflowStateV1, stage: "SOLVE" | "REVIEW" | "REVISE") {
  switch (stage) {
    case "SOLVE":
      return state.profile_snapshot.solve
    case "REVIEW":
      return state.profile_snapshot.review
    case "REVISE":
      return state.profile_snapshot.revise
    default:
      return assertNever(stage)
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected stage: ${String(value)}`)
}
