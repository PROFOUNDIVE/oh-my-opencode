import {
  CertificationJobAttemptSchema,
  type CertificationJobAttempt,
} from "../state/jobs"
import type { CertificationJobLifecycleUpdate } from "./certification-job-runtime-types"

export type CertificationJobAdvanceResult =
  | Readonly<{ readonly ok: true; readonly attempt: CertificationJobAttempt }>
  | Readonly<{ readonly ok: false; readonly message: string }>

export function advanceCertificationJob(
  attempt: CertificationJobAttempt,
  update: CertificationJobLifecycleUpdate,
  revision: number,
): CertificationJobAdvanceResult {
  if (attempt.job_id !== update.job_id) return { ok: false, message: "Lifecycle receipt job identity does not match" }
  switch (update.phase) {
    case "SESSION_CREATED":
      if (attempt.phase !== "PREPARED") return wrongPhase(attempt, update.phase)
      return parsed({ ...attempt, phase: update.phase, phase_revision: revision, child_session_id: update.child_session_id })
    case "PROMPT_SENT":
      if (attempt.phase !== "SESSION_CREATED" || attempt.child_session_id !== update.child_session_id) {
        return wrongPhase(attempt, update.phase)
      }
      return parsed({ ...attempt, phase: update.phase, phase_revision: revision })
    case "COMPLETED":
      if (attempt.phase !== "PROMPT_SENT" || attempt.child_session_id !== update.child_session_id) {
        return wrongPhase(attempt, update.phase)
      }
      return parsed({
        ...attempt,
        phase: update.phase,
        phase_revision: revision,
        raw_output_sha256: update.raw_output_sha256,
        receipt: update.receipt,
      })
    default:
      return assertNever(update)
  }
}

function parsed(input: unknown): CertificationJobAdvanceResult {
  const result = CertificationJobAttemptSchema.safeParse(input)
  return result.success
    ? { ok: true, attempt: result.data }
    : { ok: false, message: result.error.issues[0]?.message ?? "Invalid certification job lifecycle receipt" }
}

function wrongPhase(
  attempt: CertificationJobAttempt,
  requested: CertificationJobLifecycleUpdate["phase"],
): CertificationJobAdvanceResult {
  return { ok: false, message: `Cannot persist ${requested} after ${attempt.phase}` }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected certification job lifecycle update: ${String(value)}`)
}
