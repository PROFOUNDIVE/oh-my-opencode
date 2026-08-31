import { z } from "zod"

import { AttackAttemptSchema } from "../state/attacks"
import { CertificationJobTargetSchema } from "../state/jobs"
import { CertificationJobIdSchema, CertificationRevisionSchema } from "../state/literals"
import { WitnessVerificationSchema, type WitnessVerification } from "../state/witnesses"
import { witnessTargetMatchesAttack } from "../scheduler/witness-target-identity"
import { CertificationWitnessModelOutputSchema } from "./witness-model-output"

const BuildWitnessResultSchema = z.object({
  output: CertificationWitnessModelOutputSchema,
  attack: AttackAttemptSchema,
  target: CertificationJobTargetSchema,
  certification_revision: CertificationRevisionSchema,
  job_id: CertificationJobIdSchema,
}).strict().readonly()

export function buildCertificationWitnessResult(
  input: z.input<typeof BuildWitnessResultSchema>,
): WitnessVerification {
  const parsed = BuildWitnessResultSchema.parse(input)
  if (parsed.attack.outcome !== "COUNTEREXAMPLE_FOUND" || parsed.target.kind !== "WITNESS"
    || !witnessTargetMatchesAttack(parsed.target, parsed.attack)) {
    throw new CertificationWitnessBindingError()
  }
  return WitnessVerificationSchema.parse({
    witness_verification_id: parsed.target.witness_verification_id,
    certification_revision: parsed.certification_revision,
    job_id: parsed.job_id,
    attack_attempt_id: parsed.attack.attack_attempt_id,
    obligation_id: parsed.attack.obligation_id,
    node_sha256: parsed.attack.node_sha256,
    graph_sha256: parsed.attack.graph_sha256,
    artifact_sha256: parsed.attack.artifact_sha256,
    witness_sha256: parsed.attack.witness_sha256,
    outcome: parsed.output.outcome,
  })
}

export class CertificationWitnessBindingError extends Error {
  readonly name = "CertificationWitnessBindingError"

  constructor() {
    super("Witness result does not match the exact found attack and verifier target")
  }
}
