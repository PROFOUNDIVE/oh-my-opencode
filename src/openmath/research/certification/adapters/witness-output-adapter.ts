import { parseJsonOutput } from "../../../workflow/adapters/json-output-parser"
import { AttackAttemptSchema } from "../state/attacks"
import { CertificationJobTargetSchema } from "../state/jobs"
import { witnessTargetMatchesAttack } from "../scheduler/witness-target-identity"
import { hasDuplicateJsonField } from "./duplicate-json-field"
import {
  CertificationWitnessModelOutputSchema,
  type CertificationWitnessModelOutput,
} from "./witness-model-output"

export type CertificationWitnessOutputAdapterResult =
  | Readonly<{ readonly ok: true; readonly output: CertificationWitnessModelOutput }>
  | Readonly<{ readonly ok: false; readonly error: Readonly<{
      readonly code: "INVALID_JSON" | "DUPLICATE_FIELD" | "INVALID_WITNESS_OUTPUT" | "STALE_TARGET"
      readonly message: string
    }> }>

export function adaptCertificationWitnessOutput(
  rawOutput: string,
  context: Readonly<{ readonly attack: unknown; readonly target: unknown }>,
): CertificationWitnessOutputAdapterResult {
  const attack = AttackAttemptSchema.safeParse(context.attack)
  const target = CertificationJobTargetSchema.safeParse(context.target)
  if (!attack.success || attack.data.outcome !== "COUNTEREXAMPLE_FOUND"
    || !target.success || target.data.kind !== "WITNESS"
    || !witnessTargetMatchesAttack(target.data, attack.data)) {
    return failure("STALE_TARGET", "Witness output target does not match the exact found attack")
  }
  const parsed = parseJsonOutput(rawOutput)
  if (!parsed.ok) return failure("INVALID_JSON", "Witness output must be one valid JSON object")
  if (hasDuplicateJsonField(rawOutput)) return failure("DUPLICATE_FIELD", "Witness output contains a duplicate field")
  const output = CertificationWitnessModelOutputSchema.safeParse(parsed.value)
  return output.success
    ? { ok: true, output: output.data }
    : failure("INVALID_WITNESS_OUTPUT", "Witness output must contain only a permitted categorical result")
}

function failure(
  code: Extract<CertificationWitnessOutputAdapterResult, { readonly ok: false }>["error"]["code"],
  message: string,
): Extract<CertificationWitnessOutputAdapterResult, { readonly ok: false }> {
  return { ok: false, error: { code, message } }
}
