import type { CertificationJobAttempt } from "../state/jobs"
import { dispatchCertificationJob } from "./dispatch-certification-job"
import type {
  CertificationJobProgressInput,
  CertificationJobProgressResult,
  CompletedCertificationJob,
  FailedCertificationJob,
} from "./certification-job-progress-types"
import type {
  CertificationJobPersistenceErrorCode,
  CertificationJobRuntime,
} from "./certification-job-runtime-types"
import {
  reconcilePreparedCertificationJob,
  reconcileSessionCreatedCertificationJob,
  type CertificationReconciliationFailure,
} from "./reconcile-certification-job"

export async function progressCertificationJobAttempt(
  input: CertificationJobProgressInput,
): Promise<CertificationJobProgressResult> {
  const ownership = await input.runtime.verify_operation_owner()
  if (!ownership.ok) return { kind: "error", error_code: ownership.error_code, message: ownership.message }
  switch (input.attempt.phase) {
    case "PREPARED":
      return progressPrepared(input, input.attempt)
    case "SESSION_CREATED":
      return progressSessionCreated(input, input.attempt)
    case "PROMPT_SENT":
      return dispatchCertificationJob(input, input.attempt, false)
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
  input: CertificationJobProgressInput,
  attempt: Extract<CertificationJobAttempt, { readonly phase: "PREPARED" }>,
): Promise<CertificationJobProgressResult> {
  const reconciliation = await reconcilePreparedCertificationJob({
    parent_session_id: input.parent_session_id,
    attempt,
    list_children: input.runtime.list_children,
    get_session: input.runtime.get_session,
  })
  switch (reconciliation.kind) {
    case "create":
      return dispatchCertificationJob(input, attempt, true)
    case "resume": {
      const persisted = await input.runtime.persist_job_attempt({
        phase: "SESSION_CREATED",
        job_id: attempt.job_id,
        child_session_id: reconciliation.child_session_id,
      })
      return persisted.ok
        ? progressCertificationJobAttempt({ ...input, attempt: persisted.attempt })
        : persistenceError(persisted)
    }
    case "blocked":
      return persistBlocked(input.runtime, attempt.job_id, reconciliation.evidence)
    default:
      return assertNever(reconciliation)
  }
}

async function progressSessionCreated(
  input: CertificationJobProgressInput,
  attempt: Extract<CertificationJobAttempt, { readonly phase: "SESSION_CREATED" }>,
): Promise<CertificationJobProgressResult> {
  const reconciliation = await reconcileSessionCreatedCertificationJob({ attempt, list_messages: input.runtime.list_messages })
  switch (reconciliation.kind) {
    case "send":
      return dispatchCertificationJob(input, attempt, true)
    case "resume": {
      const persisted = await input.runtime.persist_job_attempt({
        phase: "PROMPT_SENT",
        job_id: attempt.job_id,
        child_session_id: attempt.child_session_id,
      })
      return persisted.ok && persisted.attempt.phase === "PROMPT_SENT"
        ? dispatchCertificationJob({ ...input, attempt: persisted.attempt }, persisted.attempt, false)
        : persisted.ok
          ? reconciliationError("Prompt persistence returned an unexpected phase")
          : persistenceError(persisted)
    }
    case "blocked":
      return persistBlocked(input.runtime, attempt.job_id, reconciliation.evidence)
    default:
      return assertNever(reconciliation)
  }
}

async function persistBlocked(
  runtime: CertificationJobRuntime,
  jobId: CertificationJobAttempt["job_id"],
  evidence: CertificationReconciliationFailure,
): Promise<CertificationJobProgressResult> {
  const result = await runtime.block_reconciliation({ job_id: jobId, evidence })
  return result.ok
    ? { kind: "blocked", reason: "RECONCILIATION_AMBIGUOUS", evidence: result.evidence }
    : persistenceError(result)
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

function assertNever(value: never): never {
  throw new TypeError(`Unexpected certification job progress variant: ${String(value)}`)
}

export type { CertificationJobProgressResult } from "./certification-job-progress-types"
