import { initializeResearchCertification } from "./initialize-research-certification"
import { readResearchCertification } from "./read-research-certification"
import { runCertificationOperation } from "./run-certification-operation"
import { loadCertificationContext } from "./load-certification-context"
import { repairCertificationGenerationIndex } from "../storage"
import { publishCompletedCertification } from "./publish-completed-certification"
import type { CertificationStepDependencies } from "./certification-scheduler-contract"
import type { CertificationApplicationFailure, CertificationStateResult } from "./certification-application-types"

export async function stepResearchCertification(input: Readonly<{
  readonly directory: string
  readonly campaign_id: string
  readonly expected_state_revision: number
  readonly expected_certification_revision: number | null
  readonly mode: "one_stage" | "to_checkpoint"
}>, dependencies: CertificationStepDependencies): Promise<CertificationStateResult> {
  let current = await readResearchCertification(input, dependencies)
  if (current.kind === "disabled") return failure("CAMPAIGN_NOT_ELIGIBLE", "Certification is not enabled")
  if (current.kind === "error") {
    if (current.reason !== "REVISION_WITHOUT_INDEX") return current
    const loaded = await loadCertificationContext(input, dependencies)
    if (loaded.kind !== "ok") return loaded.kind === "disabled"
      ? failure("CAMPAIGN_NOT_ELIGIBLE", "Certification is not enabled")
      : loaded
    if (loaded.context.campaign.state_revision !== input.expected_state_revision) {
      return failure("STALE_STATE_REVISION", "Campaign revision is stale")
    }
    const repaired = await (dependencies.repair_generation_index ?? repairCertificationGenerationIndex)({
      directory: input.directory,
      ...loaded.context.storage_identity,
      campaign_guard: {
        expected_state_revision: input.expected_state_revision,
        expected_status: "READY",
      },
    })
    if (repaired.kind === "error") return repaired
    current = await readResearchCertification(input, dependencies)
    if (current.kind !== "ok") return current.kind === "disabled"
      ? failure("CAMPAIGN_NOT_ELIGIBLE", "Certification is not enabled")
      : current
  }
  if (current.context.campaign.state_revision !== input.expected_state_revision) {
    return failure("STALE_STATE_REVISION", "Campaign revision is stale")
  }
  if (current.read.kind === "not_started") {
    if (input.expected_certification_revision !== null) return failure("STALE_CERTIFICATION_REVISION", "Certification has not started")
    const initialized = await initializeResearchCertification(input, dependencies)
    if (initialized.kind === "error") return initialized
    current = await readResearchCertification(input, dependencies)
    if (current.kind !== "ok" || current.read.kind === "not_started") {
      return current.kind === "error" ? current : failure("STORAGE_READ_FAILED", "Initialized certification is unreadable")
    }
  } else if (input.expected_certification_revision !== current.read.state.certification_revision) {
    return {
      kind: "error",
      error_code: "STALE_CERTIFICATION_REVISION",
      message: `Expected certification revision ${String(input.expected_certification_revision)}, found ${current.read.state.certification_revision}`,
      current_certification_revision: current.read.state.certification_revision,
    }
  }
  if (current.read.state.status === "COMPLETE") {
    return publishCompletedCertification(input.directory, current.context, dependencies)
  }
  let result = await runCertificationOperation({ directory: input.directory, context: current.context, state: current.read.state }, dependencies)
  while (input.mode === "to_checkpoint" && result.kind === "ok" && result.state.status === "READY") {
    const refreshed = await readResearchCertification(input, dependencies)
    if (refreshed.kind !== "ok" || refreshed.read.kind === "not_started") return failure("STORAGE_READ_FAILED", "Certification continuation is unreadable")
    result = await runCertificationOperation({ directory: input.directory, context: refreshed.context, state: refreshed.read.state }, dependencies)
  }
  return result.kind === "ok" && result.state.status === "COMPLETE"
    ? publishCompletedCertification(input.directory, current.context, dependencies)
    : result
}

function failure(errorCode: CertificationApplicationFailure["error_code"], message: string): CertificationApplicationFailure {
  return { kind: "error", error_code: errorCode, message }
}
