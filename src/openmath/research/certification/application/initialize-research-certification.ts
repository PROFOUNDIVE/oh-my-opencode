import { initializeCertification } from "../transitions"
import { initializeCertificationGeneration, readCertificationGeneration } from "../storage"
import type { CertificationApplicationDependencies } from "./certification-application-dependencies"
import type { CertificationApplicationFailure, CertificationStateResult } from "./certification-application-types"
import { loadCertificationContext } from "./load-certification-context"

export async function initializeResearchCertification(
  input: Readonly<{
    readonly directory: string
    readonly campaign_id: string
    readonly expected_state_revision: number
  }>,
  dependencies: CertificationApplicationDependencies = {},
): Promise<CertificationStateResult> {
  const loaded = await loadCertificationContext(input, dependencies)
  if (loaded.kind === "disabled") return failure("CAMPAIGN_NOT_ELIGIBLE", "Certification is not enabled")
  if (loaded.kind === "error") return loaded
  const { context } = loaded
  if (context.campaign.state_revision !== input.expected_state_revision) {
    return {
      kind: "error",
      error_code: "STALE_STATE_REVISION",
      message: `Expected campaign revision ${input.expected_state_revision}, found ${context.campaign.state_revision}`,
      current_state_revision: context.campaign.state_revision,
    }
  }
  if (context.campaign.phase !== "PROMOTION" || context.campaign.status !== "READY") {
    return failure("CAMPAIGN_NOT_ELIGIBLE", "Certification initialization requires READY promotion")
  }
  const discovered = await (dependencies.read_generation ?? readCertificationGeneration)({
    directory: input.directory,
    ...context.storage_identity,
  })
  if (discovered.kind === "ok") return failure("CERTIFICATION_ALREADY_EXISTS", "Certification generation is already initialized")
  if (discovered.kind === "error") return discovered
  const initialized = initializeCertification({
    campaign_id: context.campaign.campaign_id,
    selected_artifact: context.state_identity,
    observed_selected_artifact: context.state_identity,
    objective_sha256: context.campaign.source_snapshot.objective.sha256,
    profile_sha256: context.campaign.source_snapshot.profile.sha256,
    reference_sha256: context.campaign.source_snapshot.references.sha256,
    certification_profile_sha256: context.profile.certification_profile_sha256,
  })
  if (!initialized.ok) return failure(initialized.error_code, initialized.message)
  return (dependencies.initialize_generation ?? initializeCertificationGeneration)({
    directory: input.directory,
    state: initialized.state,
    initialized_from_campaign_revision: context.campaign.state_revision,
    campaign_guard: {
      expected_state_revision: context.campaign.state_revision,
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
