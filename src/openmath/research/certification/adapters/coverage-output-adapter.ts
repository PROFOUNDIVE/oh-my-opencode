import type { z } from "zod"

import { parseJsonOutput } from "../../../workflow/adapters/json-output-parser"
import { compareCoverageFindings } from "../state/coverage"
import {
  CertificationGraphSourceValidationSchema,
  CertificationGraphSourcesSchema,
} from "../state/graph-source-validation"
import { sourceSpanError } from "../state/source-span"
import { CoverageInputSchema } from "./coverage-input"
import { CoverageModelOutputSchema, type CoverageModelOutput } from "./coverage-model-output"
import { hasDuplicateJsonField } from "./duplicate-json-field"

export type CoverageOutputAdapterResult =
  | Readonly<{ readonly ok: true; readonly output: CoverageModelOutput }>
  | Readonly<{ readonly ok: false; readonly error: Readonly<{
      readonly code: "INVALID_JSON" | "DUPLICATE_FIELD" | "INVALID_COVERAGE_OUTPUT"
      readonly message: string
    }> }>

export type CoverageAdapterContext = Readonly<{
  readonly input: z.input<typeof CoverageInputSchema>
  readonly sources: z.input<typeof CertificationGraphSourcesSchema>
}>

export function adaptCoverageOutput(rawOutput: string, context: CoverageAdapterContext): CoverageOutputAdapterResult {
  const coverageInput = CoverageInputSchema.safeParse(context.input)
  const sources = CertificationGraphSourcesSchema.safeParse(context.sources)
  if (!coverageInput.success || !sources.success || !CertificationGraphSourceValidationSchema.safeParse({
    graph: coverageInput.data.graph,
    sources: sources.data,
  }).success) return failure("INVALID_COVERAGE_OUTPUT", "Coverage input graph or artifact is invalid")
  const parsedJson = parseJsonOutput(rawOutput)
  if (!parsedJson.ok) return failure("INVALID_JSON", "Coverage output must be one valid JSON object")
  if (hasDuplicateJsonField(rawOutput)) return failure("DUPLICATE_FIELD", "Coverage output contains a duplicate field")
  const modelOutput = CoverageModelOutputSchema.safeParse(parsedJson.value)
  if (!modelOutput.success || modelOutput.data.findings.length > coverageInput.data.max_findings) {
    return failure("INVALID_COVERAGE_OUTPUT", "Coverage output has an unsupported or over-limit shape")
  }
  const obligationIds = new Set(coverageInput.data.graph.nodes.map((node) => node.obligation_id))
  for (const finding of modelOutput.data.findings) {
    if (finding.obligation_ids.some((id) => !obligationIds.has(id))) {
      return failure("INVALID_COVERAGE_OUTPUT", "Coverage finding references an unknown obligation")
    }
    if (finding.source_span !== null && sourceSpanError(coverageInput.data.artifact.content, finding.source_span) !== null) {
      return failure("INVALID_COVERAGE_OUTPUT", "Coverage finding source span is invalid")
    }
  }
  return {
    ok: true,
    output: CoverageModelOutputSchema.parse({
      verdict: modelOutput.data.verdict,
      findings: [...modelOutput.data.findings].sort(compareCoverageFindings),
    }),
  }
}

function failure(
  code: Extract<CoverageOutputAdapterResult, { readonly ok: false }>["error"]["code"],
  message: string,
): Extract<CoverageOutputAdapterResult, { readonly ok: false }> {
  return { ok: false, error: { code, message } }
}
