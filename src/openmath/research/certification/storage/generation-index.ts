import { CertificationGenerationIndexV1Schema, type CertificationGenerationIndexV1 } from "../state/identity"
import type { ResearchCertificationStateV1 } from "../state/schema"

export function buildCertificationGenerationIndex(
  state: ResearchCertificationStateV1,
  initializedFromCampaignRevision: number,
): CertificationGenerationIndexV1 {
  return CertificationGenerationIndexV1Schema.parse({
    schema_version: 1,
    campaign_id: state.campaign_id,
    certification_id: state.certification_id,
    generation_id: state.generation_id,
    selected_artifact: state.selected_artifact,
    certification_profile_sha256: state.certification_profile_sha256,
    initialized_from_campaign_revision: initializedFromCampaignRevision,
  })
}
