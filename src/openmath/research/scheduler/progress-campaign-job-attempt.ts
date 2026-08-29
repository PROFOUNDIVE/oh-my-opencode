import type { CampaignJobAttempt } from "../state"
import { CampaignHashSchema } from "../state"
import type { CampaignErrorCode } from "../application/campaign-envelope"
import { sha256 } from "../../workflow/stage-runner/sha256"
import type { CampaignJobRuntime } from "./campaign-job-runtime-types"
import {
  reconcilePreparedCampaignJob,
  reconcileSessionCreatedCampaignJob,
} from "./reconcile-campaign-job"

type CompletedJob = Extract<CampaignJobAttempt, { readonly phase: "COMPLETED" }>
type FailedJob = CompletedJob & Readonly<{
  readonly receipt: Extract<CompletedJob["receipt"], { readonly kind: "ERROR" }>
}>

export type CampaignJobProgressResult =
  | { readonly kind: "completed"; readonly attempt: CompletedJob }
  | { readonly kind: "failed"; readonly attempt: FailedJob }
  | { readonly kind: "committed"; readonly attempt: Extract<CampaignJobAttempt, { readonly phase: "COMMITTED" }> }
  | { readonly kind: "blocked"; readonly message: string }
  | { readonly kind: "error"; readonly error_code: CampaignErrorCode; readonly message: string }

export async function progressCampaignJobAttempt(input: Readonly<{
  readonly parent_session_id: string
  readonly attempt: CampaignJobAttempt
  readonly system_content: string | undefined
  readonly user_prompt: string
  readonly receipt_from_output: (rawOutput: string) => CompletedJob["receipt"]
  readonly runtime: CampaignJobRuntime
}>): Promise<CampaignJobProgressResult> {
  switch (input.attempt.phase) {
    case "PREPARED":
      return progressPrepared(input, input.attempt)
    case "SESSION_CREATED":
      return progressSessionCreated(input, input.attempt)
    case "PROMPT_SENT":
      return dispatchCampaignJob(input, input.attempt, false)
    case "COMPLETED":
      return isFailedJob(input.attempt)
        ? { kind: "failed", attempt: input.attempt }
        : { kind: "completed", attempt: input.attempt }
    case "COMMITTED":
      return { kind: "committed", attempt: input.attempt }
    default:
      return assertNever(input.attempt)
  }
}

async function progressPrepared(
  input: Parameters<typeof progressCampaignJobAttempt>[0],
  attempt: Extract<CampaignJobAttempt, { readonly phase: "PREPARED" }>,
): Promise<CampaignJobProgressResult> {
  const reconciliation = await reconcilePreparedCampaignJob({
    parent_session_id: input.parent_session_id,
    attempt,
    list_children: input.runtime.list_children,
    get_session: input.runtime.get_session,
  })
  switch (reconciliation.kind) {
    case "create":
      return dispatchCampaignJob(input, attempt, true)
    case "resume": {
      const persisted = await input.runtime.persist_job_attempt({
        phase: "SESSION_CREATED",
        job_id: attempt.job_id,
        child_session_id: reconciliation.child_session_id,
      })
      return persisted.ok ? progressCampaignJobAttempt({ ...input, attempt: persisted.attempt }) : persistenceError(persisted)
    }
    case "blocked":
      return persistBlocked(input.runtime, attempt.job_id, reconciliation.message)
    default:
      return assertNever(reconciliation)
  }
}

async function progressSessionCreated(
  input: Parameters<typeof progressCampaignJobAttempt>[0],
  attempt: Extract<CampaignJobAttempt, { readonly phase: "SESSION_CREATED" }>,
): Promise<CampaignJobProgressResult> {
  const reconciliation = await reconcileSessionCreatedCampaignJob({ attempt, list_messages: input.runtime.list_messages })
  switch (reconciliation.kind) {
    case "send":
      return dispatchCampaignJob(input, attempt, true)
    case "resume": {
      const persisted = await input.runtime.persist_job_attempt({
        phase: "PROMPT_SENT",
        job_id: attempt.job_id,
        child_session_id: attempt.child_session_id,
      })
      if (!persisted.ok) return persistenceError(persisted)
      return persisted.attempt.phase === "PROMPT_SENT"
        ? dispatchCampaignJob({ ...input, attempt: persisted.attempt }, persisted.attempt, false)
        : { kind: "error", error_code: "RECONCILIATION_BLOCKED", message: "Prompt persistence returned an unexpected phase" }
    }
    case "blocked":
      return persistBlocked(input.runtime, attempt.job_id, reconciliation.message)
    default:
      return assertNever(reconciliation)
  }
}

async function dispatchCampaignJob(
  input: Parameters<typeof progressCampaignJobAttempt>[0],
  initial: Extract<CampaignJobAttempt, { readonly phase: "PREPARED" | "SESSION_CREATED" | "PROMPT_SENT" }>,
  sendPrompt: boolean,
): Promise<CampaignJobProgressResult> {
  let attempt: CampaignJobAttempt = initial
  let blockedMessage: string | null = null
  const result = await input.runtime.dispatch({
    parent_session_id: input.parent_session_id,
    child_title: initial.child_title,
    agent_to_use: initial.role,
    category_model: initial.resolved_model,
    system_content: input.system_content,
    user_prompt: input.user_prompt,
    prompt_marker: `OPENMATH_RESEARCH_JOB_KEY: ${initial.idempotency_key}\n`,
    persisted_session_id: "child_session_id" in initial ? initial.child_session_id : undefined,
    send_prompt: sendPrompt,
    awaited_callbacks: {
      on_session_created: async (sessionID) => {
        if (attempt.phase !== "PREPARED") return
        const persisted = await input.runtime.persist_job_attempt({ phase: "SESSION_CREATED", job_id: attempt.job_id, child_session_id: sessionID })
        if (!persisted.ok) throw new CampaignJobPersistenceError(persisted.error_code, persisted.message)
        attempt = persisted.attempt
      },
      on_prompt_sent: async () => {
        if (attempt.phase !== "SESSION_CREATED") return
        const reconciliation = await reconcileSessionCreatedCampaignJob({ attempt, list_messages: input.runtime.list_messages })
        if (reconciliation.kind !== "resume") {
          blockedMessage = reconciliation.kind === "blocked"
            ? reconciliation.message
            : "The sent campaign prompt marker was not persisted in the child transcript"
          const blocked = await persistBlocked(input.runtime, attempt.job_id, blockedMessage)
          if (blocked.kind === "error") throw new CampaignJobPersistenceError(blocked.error_code, blocked.message)
          return
        }
        const persisted = await input.runtime.persist_job_attempt({
          phase: "PROMPT_SENT",
          job_id: attempt.job_id,
          child_session_id: attempt.child_session_id,
        })
        if (!persisted.ok) throw new CampaignJobPersistenceError(persisted.error_code, persisted.message)
        attempt = persisted.attempt
      },
    },
  })
  if (blockedMessage !== null) return { kind: "blocked", message: blockedMessage }
  if (attempt.phase !== "PROMPT_SENT") {
    return persistBlocked(input.runtime, attempt.job_id, "Dispatch completed without a persisted campaign prompt receipt")
  }
  const rawOutput = result.ok ? result.text : ""
  const receipt = result.ok
    ? input.receipt_from_output(rawOutput)
    : { kind: "ERROR" as const, error_code: "SUBAGENT_FAILED", message: result.error }
  const persisted = await input.runtime.persist_job_attempt({
    phase: "COMPLETED",
    job_id: attempt.job_id,
    child_session_id: attempt.child_session_id,
    raw_output_sha256: CampaignHashSchema.parse(sha256(rawOutput)),
    receipt,
  })
  if (!persisted.ok) return persistenceError(persisted)
  if (persisted.attempt.phase !== "COMPLETED") {
    return { kind: "error", error_code: "RECONCILIATION_BLOCKED", message: "Completion persistence returned a non-completed attempt" }
  }
  return isFailedJob(persisted.attempt)
    ? { kind: "failed", attempt: persisted.attempt }
    : { kind: "completed", attempt: persisted.attempt }
}

function isFailedJob(attempt: CompletedJob): attempt is FailedJob {
  return attempt.receipt.kind === "ERROR"
}

async function persistBlocked(runtime: CampaignJobRuntime, jobId: CampaignJobAttempt["job_id"], message: string): Promise<CampaignJobProgressResult> {
  const persisted = await runtime.block_reconciliation({ job_id: jobId, message })
  return persisted.ok ? { kind: "blocked", message } : persistenceError(persisted)
}

function persistenceError(input: { readonly error_code: CampaignErrorCode; readonly message: string }): CampaignJobProgressResult {
  return { kind: "error", error_code: input.error_code, message: input.message }
}

class CampaignJobPersistenceError extends Error {
  readonly name = "CampaignJobPersistenceError"
  constructor(readonly error_code: CampaignErrorCode, message: string) {
    super(message)
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected campaign job progress variant: ${String(value)}`)
}
