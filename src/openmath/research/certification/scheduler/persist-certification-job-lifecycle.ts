import { ResearchCertificationStateV1Schema } from "../state/schema"
import {
  compareAndSwapCertificationGeneration,
  readCertificationGeneration,
  type CertificationStorageIdentityInput,
} from "../storage"
import type { CertificationCampaignGuard } from "../storage/campaign-guard"
import { advanceCertificationJob } from "./advance-certification-job"
import type {
  CertificationJobLifecycleUpdate,
  CertificationJobPersistenceResult,
} from "./certification-job-runtime-types"

export async function persistCertificationJobLifecycle(input: Readonly<{
  readonly directory: string
  readonly identity: CertificationStorageIdentityInput
  readonly update: CertificationJobLifecycleUpdate
  readonly campaign_guard?: CertificationCampaignGuard
}>): Promise<CertificationJobPersistenceResult> {
  const current = await readCertificationGeneration({ directory: input.directory, ...input.identity })
  if (current.kind === "not_started") return failure("CERTIFICATION_NOT_FOUND", "Certification generation is not initialized")
  if (current.kind === "error") return failure(current.error_code, current.message)
  if (current.state.status !== "RUNNING" || !current.state.active_job_ids.includes(input.update.job_id)) {
    return failure("RECONCILIATION_AMBIGUOUS", "Lifecycle receipt does not belong to the active certification operation")
  }
  const attempt = current.state.job_attempts.find((candidate) => candidate.job_id === input.update.job_id)
  if (attempt === undefined) return failure("RECONCILIATION_AMBIGUOUS", "Certification job was not found")
  const advanced = advanceCertificationJob(attempt, input.update, current.state.certification_revision + 1)
  if (!advanced.ok) return failure("RECONCILIATION_AMBIGUOUS", advanced.message)
  const nextState = ResearchCertificationStateV1Schema.safeParse({
    ...current.state,
    certification_revision: current.state.certification_revision + 1,
    job_attempts: current.state.job_attempts.map((candidate) => (
      candidate.job_id === advanced.attempt.job_id ? advanced.attempt : candidate
    )),
  })
  if (!nextState.success) return failure("STORAGE_WRITE_FAILED", nextState.error.issues[0]?.message ?? "Invalid certification lifecycle state")
  const persisted = await compareAndSwapCertificationGeneration({
    directory: input.directory,
    identity: input.identity,
    expected_certification_revision: current.state.certification_revision,
    next_state: nextState.data,
    campaign_guard: input.campaign_guard,
  })
  return persisted.kind === "error"
    ? failure(persisted.error_code, persisted.message)
    : { ok: true, attempt: advanced.attempt, state: persisted.state }
}

function failure(
  errorCode: Extract<CertificationJobPersistenceResult, { readonly ok: false }>["error_code"],
  message: string,
): Extract<CertificationJobPersistenceResult, { readonly ok: false }> {
  return { ok: false, error_code: errorCode, message }
}
