import { z } from "zod"

import { sha256 } from "../../../workflow/stage-runner/sha256"
import {
  CertificationJobAttemptSchema,
  CertificationJobReceiptSchema,
  type CertificationJobAttempt,
  type CertificationJobOperationalErrorCode,
} from "../state/jobs"
import { CertificationSessionIdSchema } from "../state/literals"
import type {
  CertificationJobProgressInput,
  CertificationJobProgressResult,
  CompletedCertificationJob,
  FailedCertificationJob,
} from "./certification-job-progress-types"
import type { CertificationJobPersistenceErrorCode } from "./certification-job-runtime-types"
import {
  reconcileSessionCreatedCertificationJob,
  type CertificationReconciliationFailure,
} from "./reconcile-certification-job"

const DispatchResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), session_id: CertificationSessionIdSchema, text: z.string() }).strict(),
  z.object({ ok: z.literal(false), error: z.string().min(1) }).strict(),
]).readonly()

export async function dispatchCertificationJob(
  input: CertificationJobProgressInput,
  initial: Extract<CertificationJobAttempt, { readonly phase: "PREPARED" | "SESSION_CREATED" | "PROMPT_SENT" }>,
  sendPrompt: boolean,
): Promise<CertificationJobProgressResult> {
  let attempt: CertificationJobAttempt = initial
  let blocked: CertificationReconciliationFailure | null = null
  const transportResult = await input.runtime.dispatch({
    parent_session_id: input.parent_session_id,
    child_title: initial.child_title,
    agent_to_use: initial.role,
    category_model: initial.resolved_model,
    system_content: input.system_content,
    user_prompt: input.user_prompt,
    prompt_marker: `OPENMATH_CERTIFICATION_JOB_KEY: ${initial.idempotency_key}\n`,
    persisted_session_id: "child_session_id" in initial ? initial.child_session_id : undefined,
    send_prompt: sendPrompt,
    awaited_callbacks: {
      on_session_created: async (sessionID) => {
        if (attempt.phase !== "PREPARED") return
        const persisted = await input.runtime.persist_job_attempt({ phase: "SESSION_CREATED", job_id: attempt.job_id, child_session_id: sessionID })
        if (!persisted.ok) throw new CertificationJobPersistenceError(persisted.error_code, persisted.message)
        attempt = persisted.attempt
      },
      on_prompt_sent: async () => {
        if (attempt.phase !== "SESSION_CREATED") return
        const reconciliation = await reconcileSessionCreatedCertificationJob({ attempt, list_messages: input.runtime.list_messages })
        if (reconciliation.kind !== "resume") {
          blocked = reconciliation.kind === "blocked"
            ? reconciliation.evidence
            : { kind: "MISSING_PROMPT_MARKER", child_session_id: attempt.child_session_id }
          const result = await input.runtime.block_reconciliation({ job_id: attempt.job_id, evidence: blocked })
          if (!result.ok) throw new CertificationJobPersistenceError(result.error_code, result.message)
          return
        }
        const persisted = await input.runtime.persist_job_attempt({ phase: "PROMPT_SENT", job_id: attempt.job_id, child_session_id: attempt.child_session_id })
        if (!persisted.ok) throw new CertificationJobPersistenceError(persisted.error_code, persisted.message)
        attempt = persisted.attempt
      },
    },
  })
  if (blocked !== null) return { kind: "blocked", reason: "RECONCILIATION_AMBIGUOUS", evidence: blocked }
  if (attempt.phase !== "PROMPT_SENT") {
    return blockMissingMarker(input, attempt)
  }
  const parsedTransport = DispatchResultSchema.safeParse(transportResult)
  if (!parsedTransport.success) return persistFailure(input, attempt, "ADAPTER_OUTPUT_INVALID", "Malformed certification transport result", "")
  if (!parsedTransport.data.ok) return persistFailure(input, attempt, "DISPATCH_FAILED", parsedTransport.data.error, "")
  if (parsedTransport.data.session_id !== attempt.child_session_id) {
    return persistFailure(input, attempt, "STALE_OUTPUT", `Output session ${parsedTransport.data.session_id} does not match ${attempt.child_session_id}`, parsedTransport.data.text)
  }
  let receipt: CompletedCertificationJob["receipt"]
  try {
    receipt = CertificationJobReceiptSchema.parse(input.receipt_from_output(parsedTransport.data.text))
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return persistFailure(
      input,
      attempt,
      "ADAPTER_OUTPUT_INVALID",
      error.message || "Certification output adapter rejected the response",
      parsedTransport.data.text,
    )
  }
  const completed = CertificationJobAttemptSchema.safeParse({
    ...attempt,
    phase: "COMPLETED",
    phase_revision: attempt.phase_revision + 1,
    raw_output_sha256: sha256(parsedTransport.data.text),
    receipt,
  })
  if (!completed.success) {
    return persistFailure(
      input,
      attempt,
      "ADAPTER_OUTPUT_INVALID",
      completed.error.issues[0]?.message ?? "Certification receipt does not match its job target",
      parsedTransport.data.text,
    )
  }
  return persistCompletion(input, attempt, parsedTransport.data.text, receipt)
}

async function blockMissingMarker(
  input: CertificationJobProgressInput,
  attempt: CertificationJobAttempt,
): Promise<CertificationJobProgressResult> {
  const evidence: CertificationReconciliationFailure = {
    kind: "MISSING_PROMPT_MARKER",
    child_session_id: "child_session_id" in attempt ? attempt.child_session_id : "ses_unknown",
  }
  const result = await input.runtime.block_reconciliation({ job_id: attempt.job_id, evidence })
  return result.ok
    ? { kind: "blocked", reason: "RECONCILIATION_AMBIGUOUS", evidence: result.evidence }
    : persistenceError(result)
}

async function persistFailure(
  input: CertificationJobProgressInput,
  attempt: Extract<CertificationJobAttempt, { readonly phase: "PROMPT_SENT" }>,
  errorCode: CertificationJobOperationalErrorCode,
  message: string,
  rawOutput: string,
): Promise<CertificationJobProgressResult> {
  return persistCompletion(input, attempt, rawOutput, { kind: "ERROR", error_code: errorCode, message })
}

async function persistCompletion(
  input: CertificationJobProgressInput,
  attempt: Extract<CertificationJobAttempt, { readonly phase: "PROMPT_SENT" }>,
  rawOutput: string,
  receipt: CompletedCertificationJob["receipt"],
): Promise<CertificationJobProgressResult> {
  const persisted = await input.runtime.persist_job_attempt({
    phase: "COMPLETED",
    job_id: attempt.job_id,
    child_session_id: attempt.child_session_id,
    raw_output_sha256: sha256(rawOutput),
    receipt,
  })
  if (!persisted.ok) return persistenceError(persisted)
  if (persisted.attempt.phase !== "COMPLETED") return reconciliationError("Completion persistence returned an unexpected phase")
  return isFailedJob(persisted.attempt)
    ? { kind: "failed", attempt: persisted.attempt }
    : { kind: "completed", attempt: persisted.attempt }
}

function isFailedJob(attempt: CompletedCertificationJob): attempt is FailedCertificationJob {
  return attempt.receipt.kind === "ERROR"
}

function reconciliationError(message: string): CertificationJobProgressResult {
  return { kind: "error", error_code: "RECONCILIATION_AMBIGUOUS", message }
}

function persistenceError(input: Readonly<{
  readonly error_code: CertificationJobPersistenceErrorCode
  readonly message: string
}>): CertificationJobProgressResult {
  return { kind: "error", error_code: input.error_code, message: input.message }
}

class CertificationJobPersistenceError extends Error {
  readonly name = "CertificationJobPersistenceError"

  constructor(readonly error_code: CertificationJobPersistenceErrorCode, message: string) {
    super(message)
  }
}
