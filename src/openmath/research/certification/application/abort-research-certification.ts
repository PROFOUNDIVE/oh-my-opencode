import { compareAndSwapResearchCampaignState, readResearchCampaignState } from "../../storage"
import { reduceCampaignTransition } from "../../transitions"
import type { ResearchCampaignStateV1 } from "../../state"
import { CertificationSelectedArtifactSchema } from "../state/identity"
import { CertificationSha256Schema } from "../state/literals"
import type { ResearchCertificationStateV1 } from "../state/schema"
import {
  compareAndSwapCertificationGeneration,
  readCertificationGeneration,
  type CertificationStorageIdentity,
} from "../storage"
import { reduceCertificationTransition } from "../transitions"
import type { CertificationApplicationDependencies } from "./certification-application-dependencies"
import type { CertificationApplicationFailure } from "./certification-application-types"
import { selectCertificationSource } from "./certification-selection"

export type AbortResearchCertificationResult =
  | Readonly<{
      readonly kind: "ok"
      readonly campaign: ResearchCampaignStateV1
      readonly certification: ResearchCertificationStateV1 | null
    }>
  | (CertificationApplicationFailure & Readonly<{ readonly campaign?: ResearchCampaignStateV1 }>)

export async function abortResearchCertification(input: Readonly<{
  readonly directory: string
  readonly campaign_id: string
  readonly expected_state_revision: number
  readonly expected_certification_revision: number | null
  readonly reason?: string
}>, dependencies: CertificationApplicationDependencies = {}): Promise<AbortResearchCertificationResult> {
  const campaignRead = await (dependencies.read_campaign ?? readResearchCampaignState)(input.directory, input.campaign_id)
  if (campaignRead.kind === "error") return failure("STORAGE_READ_FAILED", campaignRead.message)
  if (campaignRead.state.state_revision !== input.expected_state_revision) {
    return failure("STALE_STATE_REVISION", "Campaign revision is stale")
  }
  const selection = selectCertificationSource(campaignRead.state)
  if (selection.kind === "disabled") return failure("CAMPAIGN_NOT_ELIGIBLE", "Certification is not enabled")
  if (selection.kind === "error") return selection
  const certification = selection.sources.profile.certification
  if (certification === undefined) return failure("PROFILE_HASH_MISMATCH", "Frozen certification profile is unavailable")
  const storageIdentity = storageIdentityFor(selection, certification.certification_profile_hash)
  const sidecar = await (dependencies.read_generation ?? readCertificationGeneration)({
    directory: input.directory,
    ...storageIdentity,
  })
  const anomaly = sidecar.kind === "error"
  if (anomaly && input.expected_certification_revision !== null) {
    return failure("STALE_CERTIFICATION_REVISION", "Unreadable certification requires a null expected revision")
  }
  if (sidecar.kind === "ok" && input.expected_certification_revision !== sidecar.state.certification_revision) {
    return failure("STALE_CERTIFICATION_REVISION", "Certification revision is stale")
  }
  if (sidecar.kind === "not_started" && input.expected_certification_revision !== null) {
    return failure("STALE_CERTIFICATION_REVISION", "Uninitialized certification requires a null expected revision")
  }
  const campaignTransition = reduceCampaignTransition(campaignRead.state, { type: "ABORT", reason: input.reason ?? null })
  if (!campaignTransition.ok) return failure(campaignTransition.error_code, campaignTransition.message)
  const campaignWrite = await (dependencies.compare_and_swap_campaign ?? compareAndSwapResearchCampaignState)({
    directory: input.directory,
    campaign_id: input.campaign_id,
    expected_state_revision: campaignRead.state.state_revision,
    next_state: campaignTransition.state,
  })
  if (campaignWrite.kind === "error") return failure(campaignWrite.error_code, campaignWrite.message)
  if (anomaly) {
    return {
      kind: "error",
      error_code: "SIDECAR_CLEANUP_FAILED",
      message: sidecar.message,
      campaign: campaignWrite.state,
    }
  }
  const cleanupSidecar = await (dependencies.read_generation ?? readCertificationGeneration)({
    directory: input.directory,
    ...storageIdentity,
  })
  if (cleanupSidecar.kind === "error") {
    return { ...failure("SIDECAR_CLEANUP_FAILED", cleanupSidecar.message), campaign: campaignWrite.state }
  }
  if (cleanupSidecar.kind === "not_started" || cleanupSidecar.state.status === "COMPLETE" || cleanupSidecar.state.status === "ABORTED") {
    return {
      kind: "ok",
      campaign: campaignWrite.state,
      certification: cleanupSidecar.kind === "ok" ? cleanupSidecar.state : null,
    }
  }
  const aborted = reduceCertificationTransition(
    cleanupSidecar.state,
    { type: "ABORT", reason: input.reason ?? null },
    cleanupSidecar.state.certification_revision,
  )
  if (!aborted.ok) {
    return { ...failure("SIDECAR_CLEANUP_FAILED", aborted.message), campaign: campaignWrite.state }
  }
  const sidecarWrite = await (dependencies.compare_and_swap_generation ?? compareAndSwapCertificationGeneration)({
    directory: input.directory,
    identity: storageIdentity,
    expected_certification_revision: cleanupSidecar.state.certification_revision,
    next_state: aborted.state,
    campaign_guard: {
      expected_state_revision: campaignWrite.state.state_revision,
      expected_status: "ABORTED",
    },
  })
  return sidecarWrite.kind === "ok"
    ? { kind: "ok", campaign: campaignWrite.state, certification: sidecarWrite.state }
    : { ...failure("SIDECAR_CLEANUP_FAILED", sidecarWrite.message), campaign: campaignWrite.state }
}

function storageIdentityFor(
  selection: Extract<ReturnType<typeof selectCertificationSource>, { readonly kind: "enabled" }>,
  certificationProfileSha256: string,
): CertificationStorageIdentity {
  return {
    campaign_id: selection.campaign.campaign_id,
    selected_artifact: CertificationSelectedArtifactSchema.parse({
      candidate_id: selection.candidate.candidate_id,
      child_run_id: selection.candidate.child_run_id,
      child_state_revision: selection.candidate.child_state_revision,
      artifact_version: selection.candidate.artifact.artifact_version,
      media_type: selection.candidate.artifact.media_type,
      artifact_sha256: selection.candidate.artifact.sha256,
    }),
    certification_profile_sha256: CertificationSha256Schema.parse(certificationProfileSha256),
    initialized_from_campaign_revision: initializationRevision(selection.campaign),
  }
}

function initializationRevision(campaign: ResearchCampaignStateV1): number {
  if (campaign.dossier !== null) return campaign.dossier.created_at_revision - 2
  return campaign.attachments.some(({ kind }) => kind === "research-certification")
    ? campaign.state_revision - 1
    : campaign.state_revision
}

function failure(errorCode: CertificationApplicationFailure["error_code"], message: string): CertificationApplicationFailure {
  return { kind: "error", error_code: errorCode, message }
}
