import { ResearchCertificationStateV1Schema, type ResearchCertificationStateV1 } from "../state/schema"
import type { CertificationTransitionErrorCode, CertificationTransitionResult } from "./types"

export function certificationFailure(
  state: ResearchCertificationStateV1,
  errorCode: CertificationTransitionErrorCode,
  message: string,
): CertificationTransitionResult {
  return { ok: false, error_code: errorCode, message, state }
}

export function certificationSuccess(
  previous: ResearchCertificationStateV1,
  next: unknown,
): CertificationTransitionResult {
  const parsed = ResearchCertificationStateV1Schema.safeParse(next)
  return parsed.success
    ? { ok: true, state: parsed.data }
    : certificationFailure(previous, "VALIDATION_ERROR", "Certification transition would violate state invariants")
}
