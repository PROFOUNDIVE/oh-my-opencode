import { formatOpenMathArtifactsMarkdown } from "../../artifacts-markdown/format"
import { hashOpenMathArtifactsMarkdown } from "../../artifacts-markdown/hash"
import { parseOpenMathArtifactsMarkdown } from "../../artifacts-markdown/parse"
import { SolverArtifactsSchema } from "../../../tools/openmath-solve-only/subagent-output-schemas"
import { extractParserValidatedMarkdownCandidate } from "../../../tools/openmath-solve-only/markdown-candidate-extractor"
import { parseJsonOutput } from "./json-output-parser"
import type { AdapterResult, LegacyJsonArtifacts } from "./types"

export function adaptLegacyOmoSections(rawOutput: string): AdapterResult {
  const candidate = extractParserValidatedMarkdownCandidate(rawOutput)
  if (!candidate.ok) {
    return {
      ok: false,
      error: {
        kind: "adapter_error",
        code: "INVALID_LEGACY_SECTIONS",
        message: candidate.message,
        raw_output: rawOutput,
      },
    }
  }

  const parsed = parseOpenMathArtifactsMarkdown(candidate.value)
  if (!parsed.ok) {
    return {
      ok: false,
      error: {
        kind: "adapter_error",
        code: "INVALID_LEGACY_SECTIONS",
        message: parsed.error.message,
        raw_output: rawOutput,
      },
    }
  }

  const content = formatOpenMathArtifactsMarkdown(parsed.draft)
  return {
    ok: true,
    kind: "markdown_artifact",
    adapter: "legacy_omo_sections",
    artifact: {
      media_type: "text/markdown",
      content,
      hash: hashOpenMathArtifactsMarkdown(content),
      draft: parsed.draft,
    },
  }
}

export function adaptLegacyJsonArtifacts(rawOutput: string): AdapterResult {
  const parsedJson = parseJsonOutput(rawOutput)
  if (!parsedJson.ok) {
    return {
      ok: false,
      error: {
        kind: "adapter_error",
        code: "INVALID_JSON",
        message: "Legacy artifact output is not valid JSON",
        raw_output: rawOutput,
      },
    }
  }

  const artifacts = SolverArtifactsSchema.safeParse(parsedJson.value)
  if (!artifacts.success) {
    return {
      ok: false,
      error: {
        kind: "adapter_error",
        code: "INVALID_LEGACY_ARTIFACTS",
        message: "Legacy artifact output does not match SolverArtifactsSchema",
        raw_output: rawOutput,
      },
    }
  }

  const output: LegacyJsonArtifacts = artifacts.data
  return { ok: true, kind: "legacy_json_artifacts", adapter: "legacy_json_artifacts", artifacts: output }
}
