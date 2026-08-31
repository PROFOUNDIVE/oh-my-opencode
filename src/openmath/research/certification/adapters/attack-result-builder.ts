import { z } from "zod"

import { sha256 } from "../../../workflow/stage-runner/sha256"
import { AttackAttemptSchema, type AttackAttempt } from "../state/attacks"
import { CertificationJobTargetSchema } from "../state/jobs"
import { CertificationJobIdSchema, CertificationRevisionSchema } from "../state/literals"
import { CertificationAttackPlanEntrySchema } from "../scheduler/attack-planner"
import { attackTargetMatchesPlan } from "../scheduler/attack-target-identity"
import { CertificationAttackModelOutputSchema } from "./attack-model-output"
import type { CertificationAttackModelOutput } from "./attack-model-output"

const BuildAttackResultSchema = z.object({
  output: CertificationAttackModelOutputSchema,
  expected_attempt: CertificationAttackPlanEntrySchema,
  target: CertificationJobTargetSchema,
  certification_revision: CertificationRevisionSchema,
  job_id: CertificationJobIdSchema,
}).strict().readonly()

export type CertificationAttackBuildResult = Readonly<{
  readonly attack: AttackAttempt
  readonly evidence_type: "LLM_COUNTERARGUMENT"
  readonly untrusted_metadata: Readonly<{ readonly reported_case_count: number | null }>
}>

export function buildCertificationAttackResult(
  input: z.input<typeof BuildAttackResultSchema>,
): CertificationAttackBuildResult {
  const parsed = BuildAttackResultSchema.parse(input)
  if (parsed.target.kind !== "ATTACK" || !attackTargetMatchesPlan(parsed.target, parsed.expected_attempt)) {
    throw new CertificationAttackBindingError()
  }
  const attack = AttackAttemptSchema.parse({
    ...parsed.expected_attempt,
    certification_revision: parsed.certification_revision,
    job_id: parsed.job_id,
    ...attackResultFields(parsed.output),
  })
  return {
    attack,
    evidence_type: "LLM_COUNTERARGUMENT",
    untrusted_metadata: { reported_case_count: parsed.output.reported_case_count },
  }
}

function attackResultFields(output: CertificationAttackModelOutput) {
  switch (output.outcome) {
    case "COUNTEREXAMPLE_FOUND":
      return { outcome: output.outcome, witness: output.witness, witness_sha256: sha256(output.witness) }
    case "NO_COUNTEREXAMPLE_FOUND":
    case "INVALID_TARGET":
    case "INCONCLUSIVE":
      return { outcome: output.outcome, witness: null, witness_sha256: null }
    default:
      return assertNever(output)
  }
}

export class CertificationAttackBindingError extends Error {
  readonly name = "CertificationAttackBindingError"

  constructor() {
    super("Attack result target does not match the canonical plan")
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected certification attack output: ${String(value)}`)
}
