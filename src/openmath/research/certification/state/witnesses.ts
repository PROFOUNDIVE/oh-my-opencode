import { z } from "zod"

import { sha256 } from "../../../workflow/stage-runner/sha256"
import {
  AttackAttemptIdSchema,
  CertificationJobIdSchema,
  CertificationRevisionSchema,
  CertificationSha256Schema,
  ObligationIdSchema,
  WitnessVerificationIdSchema,
} from "./literals"

export const WitnessOutcomeSchema = z.enum(["CONFIRMED", "REJECTED", "INCONCLUSIVE"])

export const WitnessVerificationSchema = z.object({
  witness_verification_id: WitnessVerificationIdSchema,
  certification_revision: CertificationRevisionSchema,
  job_id: CertificationJobIdSchema,
  attack_attempt_id: AttackAttemptIdSchema,
  obligation_id: ObligationIdSchema,
  node_sha256: CertificationSha256Schema,
  graph_sha256: CertificationSha256Schema,
  artifact_sha256: CertificationSha256Schema,
  witness_sha256: CertificationSha256Schema,
  outcome: WitnessOutcomeSchema,
}).strict().readonly()

export function hashWitnessVerification(verification: z.infer<typeof WitnessVerificationSchema>): string {
  return sha256(JSON.stringify(verification))
}

export type WitnessVerification = z.infer<typeof WitnessVerificationSchema>
