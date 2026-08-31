import { compareAndSwapCertificationGeneration, readCertificationGeneration } from "../storage"
import { reduceCertificationTransition } from "../transitions"
import type { CertificationSchedulerTransition, CertificationStepDependencies } from "./certification-scheduler-contract"
import type { CertificationApplicationFailure, CertificationStateResult } from "./certification-application-types"
import { loadCertificationContext } from "./load-certification-context"

export async function commitCertificationTransition(input: Readonly<{
  readonly directory: string
  readonly campaign_id: string
  readonly expected_state_revision: number
  readonly event: CertificationSchedulerTransition
}>, dependencies: CertificationStepDependencies): Promise<CertificationStateResult> {
  const loaded = await loadCertificationContext(input, dependencies)
  if (loaded.kind === "disabled") return failure("CAMPAIGN_NOT_ELIGIBLE", "Certification is not enabled")
  if (loaded.kind === "error") return loaded
  if (loaded.context.campaign.state_revision !== input.expected_state_revision) {
    return failure("STALE_STATE_REVISION", "Campaign changed before certification result application")
  }
  if (loaded.context.campaign.status !== "READY") {
    return failure("CAMPAIGN_ABORTED", "Campaign is no longer eligible for certification results")
  }
  const current = await (dependencies.read_generation ?? readCertificationGeneration)({
    directory: input.directory,
    ...loaded.context.storage_identity,
  })
  if (current.kind === "not_started") return failure("CERTIFICATION_NOT_FOUND", "Certification is not initialized")
  if (current.kind === "error") return current
  const transition = reduceCertificationTransition(current.state, input.event, current.state.certification_revision)
  if (!transition.ok) return failure(transition.error_code, transition.message)
  return (dependencies.compare_and_swap_generation ?? compareAndSwapCertificationGeneration)({
    directory: input.directory,
    identity: loaded.context.storage_identity,
    expected_certification_revision: current.state.certification_revision,
    next_state: transition.state,
    campaign_guard: {
      expected_state_revision: input.expected_state_revision,
      expected_status: "READY",
    },
  })
}

function failure(
  errorCode: CertificationApplicationFailure["error_code"],
  message: string,
): CertificationApplicationFailure {
  return { kind: "error", error_code: errorCode, message }
}
