import { parseOpenMathArtifactsMarkdown } from "../../openmath/artifacts-markdown/parse"
import type { ExtractionFailure, ExtractionSuccess } from "./extraction-result"
import { stripProtocolNoise } from "./protocol-noise-stripper"

const REFERENCE_SECTION_START = "<!-- OMO:SECTION reference_solution -->"
const SECTION_END = "<!-- OMO:ENDSECTION -->"

export function extractParserValidatedMarkdownCandidate(
  text: string,
): ExtractionSuccess<string> | ExtractionFailure {
  const cleaned = stripProtocolNoise(text)
  const lines = cleaned.split("\n")

  const startIndexes: number[] = []
  const endIndexes: number[] = []

  for (let index = 0; index < lines.length; index++) {
    const trimmed = lines[index].trim()
    if (trimmed === REFERENCE_SECTION_START) {
      startIndexes.push(index)
    }
    if (trimmed === SECTION_END) {
      endIndexes.push(index)
    }
  }

  if (startIndexes.length === 0 || endIndexes.length === 0) {
    return {
      ok: false,
      stage: "candidate_scan",
      error_code: "MARKDOWN_CANDIDATE_NOT_FOUND",
      attempts: 0,
      message: "No markdown candidate boundaries found",
    }
  }

  let attempts = 0
  let selectedCandidateIndex = -1
  let lastParseFailureMessage = "No parser-valid markdown candidate found"

  for (const startIndex of startIndexes) {
    for (const endIndex of endIndexes) {
      if (endIndex < startIndex) {
        continue
      }

      const candidate = lines.slice(startIndex, endIndex + 1).join("\n").trim()
      if (candidate.length === 0) {
        continue
      }

      attempts += 1
      selectedCandidateIndex += 1
      const candidateWithTrailingNewline = `${candidate}\n`
      const parsed = parseOpenMathArtifactsMarkdown(candidateWithTrailingNewline)
      if (parsed.ok) {
        return {
          ok: true,
          value: parsed.normalizedMarkdown,
          attempts,
          selected_candidate_index: selectedCandidateIndex,
        }
      }

      lastParseFailureMessage = parsed.error.message
    }
  }

  return {
    ok: false,
    stage: "parse",
    error_code: "ARTIFACTS_PARSE_ERROR",
    attempts,
    message: lastParseFailureMessage,
  }
}
