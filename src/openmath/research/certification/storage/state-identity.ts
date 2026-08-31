import { deriveCertificationIdentity } from "../state/identity"
import type { ResearchCertificationStateV1 } from "../state/schema"
import type { CertificationStorageIdentity } from "./storage-identity"

export function certificationStateMatchesIdentity(
  state: ResearchCertificationStateV1,
  identity: CertificationStorageIdentity,
): boolean {
  const expected = deriveCertificationIdentity({
    campaign_id: identity.campaign_id,
    selected_artifact_sha256: identity.selected_artifact.artifact_sha256,
    certification_profile_sha256: identity.certification_profile_sha256,
  })
  return state.campaign_id === identity.campaign_id
    && state.certification_id === expected.certification_id
    && state.generation_id === expected.generation_id
    && JSON.stringify(state.selected_artifact) === JSON.stringify(identity.selected_artifact)
    && state.certification_profile_sha256 === identity.certification_profile_sha256
}

export function certificationStatesShareIdentity(
  current: ResearchCertificationStateV1,
  next: ResearchCertificationStateV1,
): boolean {
  return current.schema_version === next.schema_version
    && current.certification_id === next.certification_id
    && current.generation_id === next.generation_id
    && current.campaign_id === next.campaign_id
    && JSON.stringify(current.selected_artifact) === JSON.stringify(next.selected_artifact)
    && current.objective_sha256 === next.objective_sha256
    && current.profile_sha256 === next.profile_sha256
    && current.reference_sha256 === next.reference_sha256
    && current.certification_profile_sha256 === next.certification_profile_sha256
}
