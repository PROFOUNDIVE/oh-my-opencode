import type { CertificationContext } from "../application/certification-application-types"
import { certificationRoundContextFromApplication } from "./certification-round-context"
import type { WitnessVerificationContext } from "./witness-verification-types"

export function witnessVerificationContextFromApplication(context: CertificationContext): WitnessVerificationContext {
  const certification = context.sources.profile.certification
  if (certification === undefined) throw new WitnessVerificationContextError()
  const round = certificationRoundContextFromApplication(context)
  return {
    parent_session_id: round.parent_session_id,
    sources: round.sources,
    profile_sha256: round.profile_sha256,
    reference_sha256: round.reference_sha256,
    certification_profile_sha256: round.profile.certification_profile_sha256,
    witness_role: certification.witness_role,
  }
}

export class WitnessVerificationContextError extends Error {
  readonly name = "WitnessVerificationContextError"

  constructor() {
    super("Witness verification requires a frozen certification profile")
  }
}
