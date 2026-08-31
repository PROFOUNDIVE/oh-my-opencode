import { parseJsonOutput } from "../../../workflow/adapters/json-output-parser"
import { CertificationJobTargetSchema } from "../state/jobs"
import {
  CertificationAttackPlanEntrySchema,
  type CertificationAttackPlanEntry,
} from "../scheduler/attack-planner"
import { attackTargetMatchesPlan } from "../scheduler/attack-target-identity"
import { hasDuplicateJsonField } from "./duplicate-json-field"
import {
  CertificationAttackModelOutputSchema,
  type CertificationAttackModelOutput,
} from "./attack-model-output"

type AttackTarget = Extract<ReturnType<typeof CertificationJobTargetSchema.parse>, { readonly kind: "ATTACK" }>

export type CertificationAttackAdapterContext = Readonly<{
  readonly expected_attempt: CertificationAttackPlanEntry
  readonly target: AttackTarget
}>

export type CertificationAttackOutputAdapterResult =
  | Readonly<{ readonly ok: true; readonly output: CertificationAttackModelOutput }>
  | Readonly<{ readonly ok: false; readonly error: Readonly<{
      readonly code: "INVALID_JSON" | "DUPLICATE_FIELD" | "INVALID_ATTACK_OUTPUT" | "STALE_TARGET"
      readonly message: string
    }> }>

export function adaptCertificationAttackOutput(
  rawOutput: string,
  context: Readonly<{ readonly expected_attempt: unknown; readonly target: unknown }>,
): CertificationAttackOutputAdapterResult {
  const expected = CertificationAttackPlanEntrySchema.safeParse(context.expected_attempt)
  const target = CertificationJobTargetSchema.safeParse(context.target)
  if (!expected.success || !target.success || target.data.kind !== "ATTACK"
    || !attackTargetMatchesPlan(target.data, expected.data)) {
    return failure("STALE_TARGET", "Attack output target does not match the canonical plan")
  }
  const parsed = parseJsonOutput(rawOutput)
  if (!parsed.ok) return failure("INVALID_JSON", "Attack output must be one valid JSON object")
  if (hasDuplicateJsonField(rawOutput)) return failure("DUPLICATE_FIELD", "Attack output contains a duplicate field")
  const output = CertificationAttackModelOutputSchema.safeParse(parsed.value)
  return output.success
    ? { ok: true, output: output.data }
    : failure("INVALID_ATTACK_OUTPUT", "Attack output must contain only a permitted categorical result")
}

function failure(
  code: Extract<CertificationAttackOutputAdapterResult, { readonly ok: false }>["error"]["code"],
  message: string,
): Extract<CertificationAttackOutputAdapterResult, { readonly ok: false }> {
  return { ok: false, error: { code, message } }
}
