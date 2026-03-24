import type { ExtractionFailure, ExtractionSuccess } from "./extraction-result"
import { stripProtocolNoise } from "./protocol-noise-stripper"

type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; message?: string }

export function extractJsonCandidatesFromText(text: string): string[] {
  const cleaned = stripProtocolNoise(text)
  const spans = collectTopLevelJsonSpans(cleaned)
  const ordered = spans.sort((a, b) => {
    if (b.end !== a.end) return b.end - a.end
    return b.start - a.start
  })

  return ordered
    .map((span) => cleaned.slice(span.start, span.end + 1).trim())
    .filter((candidate) => candidate.startsWith("{") || candidate.startsWith("["))
}

export function extractSchemaValidatedJsonCandidate<T>(args: {
  text: string
  validate: (value: unknown) => ValidationResult<T>
}): ExtractionSuccess<T> | ExtractionFailure {
  const candidates = extractJsonCandidatesFromText(args.text)
  if (candidates.length === 0) {
    return {
      ok: false,
      stage: "candidate_scan",
      error_code: "JSON_CANDIDATE_NOT_FOUND",
      attempts: 0,
      message: "No JSON candidate found in output",
    }
  }

  let attempts = 0
  let sawParseableCandidate = false
  let lastSchemaMessage = "No schema-valid JSON candidate found"

  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index]
    attempts += 1

    let parsed: unknown
    try {
      parsed = JSON.parse(candidate)
      sawParseableCandidate = true
    } catch {
      continue
    }

    const validated = args.validate(parsed)
    if (validated.success) {
      return {
        ok: true,
        value: validated.data,
        attempts,
        selected_candidate_index: index,
      }
    }

    if (validated.message) {
      lastSchemaMessage = validated.message
    }
  }

  if (sawParseableCandidate) {
    return {
      ok: false,
      stage: "schema",
      error_code: "JSON_SCHEMA_INVALID",
      attempts,
      message: lastSchemaMessage,
    }
  }

  return {
    ok: false,
    stage: "parse",
    error_code: "JSON_PARSE_ERROR",
    attempts,
    message: "All JSON candidates failed to parse",
  }
}

function collectTopLevelJsonSpans(text: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = []
  const stack: Array<{ char: "{" | "["; start: number }> = []
  let inString = false
  let escaping = false

  for (let index = 0; index < text.length; index++) {
    const char = text[index]

    if (inString) {
      if (escaping) {
        escaping = false
        continue
      }
      if (char === "\\") {
        escaping = true
        continue
      }
      if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }

    if (char === "{" || char === "[") {
      stack.push({ char, start: index })
      continue
    }

    if (char === "}" || char === "]") {
      const open = stack[stack.length - 1]
      if (!open) {
        continue
      }

      const matches = (open.char === "{" && char === "}") || (open.char === "[" && char === "]")
      if (!matches) {
        stack.length = 0
        continue
      }

      stack.pop()
      if (stack.length === 0) {
        spans.push({ start: open.start, end: index })
      }
    }
  }

  return spans
}
