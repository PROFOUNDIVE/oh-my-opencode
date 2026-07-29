import type { WorkflowStateV1 } from "../state"
import { sha256 } from "./sha256"

type StageAttempt = WorkflowStateV1["dispatch_attempts"][number]
type PreparedAttempt = Extract<StageAttempt, { readonly phase: "PREPARED" }>
type SessionCreatedAttempt = Extract<StageAttempt, { readonly phase: "SESSION_CREATED" }>
type PromptSentAttempt = Extract<StageAttempt, { readonly phase: "PROMPT_SENT" }>

export function sessionCreatedAttempt(attempt: PreparedAttempt, childSessionID: string): SessionCreatedAttempt {
  return { ...attempt, phase: "SESSION_CREATED", child_session_id: childSessionID }
}

export function promptSentAttempt(attempt: SessionCreatedAttempt): PromptSentAttempt {
  return { ...attempt, phase: "PROMPT_SENT" }
}

export function completedAttempt(
  attempt: PromptSentAttempt,
  rawOutput: string,
  receipt: Extract<StageAttempt, { readonly phase: "COMPLETED" }>["receipt"],
): Extract<StageAttempt, { readonly phase: "COMPLETED" }> {
  return {
    ...attempt,
    phase: "COMPLETED",
    raw_output: rawOutput,
    output_hash: sha256(rawOutput),
    receipt,
  }
}

export function replaceAttempt(
  state: Extract<WorkflowStateV1, { readonly status: "RUNNING" }>,
  replacement: StageAttempt,
): Extract<WorkflowStateV1, { readonly status: "RUNNING" }> {
  return {
    ...state,
    dispatch_attempts: state.dispatch_attempts.map((attempt) => (
      attempt.idempotency_key === replacement.idempotency_key ? replacement : attempt
    )),
  }
}
