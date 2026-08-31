import { reduceCertificationTransition } from "../transitions/reduce-transition"
import {
  compareAndSwapCertificationGeneration,
  readCertificationGeneration,
  type CertificationStorageIdentityInput,
} from "../storage"
import type { CertificationJobAttempt } from "../state/jobs"
import type { CertificationJobBlockResult } from "./certification-job-runtime-types"
import type { CertificationReconciliationFailure } from "./reconcile-certification-job"
import type { CertificationCampaignGuard } from "../storage/campaign-guard"

export async function blockCertificationJobOperation(input: Readonly<{
  readonly directory: string
  readonly identity: CertificationStorageIdentityInput
  readonly job_id: CertificationJobAttempt["job_id"]
  readonly evidence: CertificationReconciliationFailure
  readonly campaign_guard?: CertificationCampaignGuard
}>): Promise<CertificationJobBlockResult> {
  const current = await readCertificationGeneration({ directory: input.directory, ...input.identity })
  if (current.kind === "not_started") return failure("CERTIFICATION_NOT_FOUND", "Certification generation is not initialized")
  if (current.kind === "error") return failure(current.error_code, current.message)
  if (current.state.status !== "RUNNING" || !current.state.active_job_ids.includes(input.job_id)) {
    return failure("RECONCILIATION_AMBIGUOUS", "Reconciliation failure does not belong to the active certification operation")
  }
  const blocked = reduceCertificationTransition(
    current.state,
    { type: "BLOCK", reason: "RECONCILIATION_AMBIGUOUS" },
    current.state.certification_revision,
  )
  if (!blocked.ok) return failure("RECONCILIATION_AMBIGUOUS", blocked.message)
  const persisted = await compareAndSwapCertificationGeneration({
    directory: input.directory,
    identity: input.identity,
    expected_certification_revision: current.state.certification_revision,
    next_state: blocked.state,
    campaign_guard: input.campaign_guard,
  })
  return persisted.kind === "error"
    ? failure(persisted.error_code, persisted.message)
    : { ok: true, state: persisted.state, evidence: input.evidence }
}

function failure(
  errorCode: Extract<CertificationJobBlockResult, { readonly ok: false }>["error_code"],
  message: string,
): Extract<CertificationJobBlockResult, { readonly ok: false }> {
  return { ok: false, error_code: errorCode, message }
}
