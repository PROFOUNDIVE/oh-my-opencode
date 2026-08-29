import { visit } from "jsonc-parser"
import { parseJsonOutput } from "../../workflow/adapters/json-output-parser"
import { ScreenNormalizedOutputSchema, type ScreenNormalizedOutput } from "../state"

export { ScreenNormalizedOutputSchema }
export type { ScreenNormalizedOutput }

export type ScreenOutputAdapterError = Readonly<{
  readonly code: "INVALID_JSON" | "DUPLICATE_FIELD" | "INVALID_SCREEN_OUTPUT"
  readonly message: string
  readonly raw_output: string
}>

export type ScreenOutputAdapterResult =
  | Readonly<{ readonly ok: true; readonly output: ScreenNormalizedOutput }>
  | Readonly<{ readonly ok: false; readonly error: ScreenOutputAdapterError }>

export function adaptScreenOutput(rawOutput: string): ScreenOutputAdapterResult {
  const parsed = parseJsonOutput(rawOutput)
  if (!parsed.ok) return failure("INVALID_JSON", "Screen output must be one valid JSON object", rawOutput)
  if (hasDuplicateRootField(rawOutput)) {
    return failure("DUPLICATE_FIELD", "Screen output contains a duplicate root field", rawOutput)
  }
  const normalized = ScreenNormalizedOutputSchema.safeParse(parsed.value)
  if (!normalized.success) {
    return failure("INVALID_SCREEN_OUTPUT", "Screen output must contain exactly the normalized screen fields", rawOutput)
  }
  return { ok: true, output: normalized.data }
}

function hasDuplicateRootField(rawOutput: string): boolean {
  const fields = new Set<string>()
  let duplicate = false
  visit(rawOutput, {
    onObjectProperty: (property, _offset, _length, _line, _character, pathSupplier) => {
      if (pathSupplier().length !== 0) return
      if (fields.has(property)) duplicate = true
      fields.add(property)
    },
  }, { disallowComments: true, allowTrailingComma: false, allowEmptyContent: false })
  return duplicate
}

function failure(
  code: "INVALID_JSON" | "DUPLICATE_FIELD" | "INVALID_SCREEN_OUTPUT",
  message: string,
  rawOutput: string,
): ScreenOutputAdapterResult {
  return { ok: false, error: { code, message, raw_output: rawOutput } }
}
