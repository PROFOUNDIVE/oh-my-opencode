import type { CertificationGenerationIndexV1 } from "../state/identity"
import { CertificationGenerationIndexV1Schema } from "../state/identity"
import { ResearchCertificationStateV1Schema, type ResearchCertificationStateV1 } from "../state/schema"

export function serializeCertificationRevision(state: ResearchCertificationStateV1): string {
  return JSON.stringify(ResearchCertificationStateV1Schema.parse(state))
}

export function serializeCertificationGenerationIndex(index: CertificationGenerationIndexV1): string {
  return JSON.stringify(CertificationGenerationIndexV1Schema.parse(index))
}
