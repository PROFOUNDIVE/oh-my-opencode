import { sha256 } from "../../../workflow/stage-runner/sha256"
import { initializeCertification } from "../transitions"

export const STORAGE_PROFILE_HASH = "2".repeat(64)

export function createCertificationStorageState(campaignId: string, artifactHash = "1".repeat(64)) {
  const selectedArtifact = {
    candidate_id: "candidate-01",
    child_run_id: `${campaignId}::candidate-01`,
    child_state_revision: 7,
    artifact_version: 2,
    media_type: "text/markdown" as const,
    artifact_sha256: artifactHash,
  }
  const result = initializeCertification({
    campaign_id: campaignId,
    selected_artifact: selectedArtifact,
    observed_selected_artifact: selectedArtifact,
    objective_sha256: sha256(`${campaignId}:objective`),
    profile_sha256: sha256(`${campaignId}:profile`),
    reference_sha256: sha256(`${campaignId}:reference`),
    certification_profile_sha256: STORAGE_PROFILE_HASH,
  })
  if (!result.ok) throw new TypeError(`Unable to create storage fixture: ${result.message}`)
  return result.state
}

export function storageIdentity(state: ReturnType<typeof createCertificationStorageState>) {
  return {
    campaign_id: state.campaign_id,
    selected_artifact: state.selected_artifact,
    certification_profile_sha256: state.certification_profile_sha256,
    initialized_from_campaign_revision: 12,
  }
}
