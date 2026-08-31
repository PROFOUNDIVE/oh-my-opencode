import { z } from "zod"

import { parseJsonOutput } from "../../../workflow/adapters/json-output-parser"
import type { CertificationGraph } from "../state/graph"
import { CertificationGraphSourcesSchema } from "../state/graph-source-validation"
import { buildExtractionGraph } from "./extraction-graph-builder"
import { ExtractionModelOutputSchema } from "./extraction-model-output"
import { hasDuplicateJsonField } from "./duplicate-json-field"

const ExtractionAdapterContextSchema = z.object({
  sources: CertificationGraphSourcesSchema,
  max_obligations: z.number().int().min(1).max(256),
}).strict().readonly()

export type ExtractionOutputAdapterResult =
  | Readonly<{ readonly ok: true; readonly graph: CertificationGraph }>
  | Readonly<{ readonly ok: false; readonly error: Readonly<{
      readonly code: "INVALID_JSON" | "DUPLICATE_FIELD" | "INVALID_EXTRACTION_OUTPUT"
      readonly message: string
    }> }>

export function adaptExtractionOutput(
  rawOutput: string,
  context: z.input<typeof ExtractionAdapterContextSchema>,
): ExtractionOutputAdapterResult {
  const parsedContext = ExtractionAdapterContextSchema.safeParse(context)
  if (!parsedContext.success) return failure("INVALID_EXTRACTION_OUTPUT", "Extraction sources or bounds are invalid")
  const parsedJson = parseJsonOutput(rawOutput)
  if (!parsedJson.ok) return failure("INVALID_JSON", "Extraction output must be one valid JSON object")
  if (hasDuplicateJsonField(rawOutput)) return failure("DUPLICATE_FIELD", "Extraction output contains a duplicate field")
  const modelOutput = ExtractionModelOutputSchema.safeParse(parsedJson.value)
  if (!modelOutput.success || modelOutput.data.nodes.length > parsedContext.data.max_obligations) {
    return failure("INVALID_EXTRACTION_OUTPUT", "Extraction output has an unsupported or over-limit shape")
  }
  const graph = buildExtractionGraph(modelOutput.data, parsedContext.data.sources)
  return graph === null
    ? failure("INVALID_EXTRACTION_OUTPUT", "Extraction output violates canonical graph or source binding")
    : { ok: true, graph }
}

function failure(
  code: Extract<ExtractionOutputAdapterResult, { readonly ok: false }>["error"]["code"],
  message: string,
): Extract<ExtractionOutputAdapterResult, { readonly ok: false }> {
  return { ok: false, error: { code, message } }
}
