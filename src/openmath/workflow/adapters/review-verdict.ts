import { ReviewerJsonOutputSchema } from "../../../tools/openmath-solve-only/subagent-output-schemas"
import { LegacyReviewMetadataSchema } from "../state/contracts"
import { parseJsonOutput } from "./json-output-parser"
import type { AdapterResult, CanonicalReviewVerdict } from "./types"

export function adaptJsonReviewVerdict(rawOutput: string): AdapterResult {
  const parsedJson = parseJsonOutput(rawOutput)
  if (!parsedJson.ok) return invalidJsonError(rawOutput)

  const review = ReviewerJsonOutputSchema.safeParse(parsedJson.value)
  if (!review.success) {
    return {
      ok: false,
      error: {
        kind: "adapter_error",
        code: "INVALID_REVIEW_VERDICT",
        message: "Review output does not match ReviewerJsonOutputSchema",
        raw_output: rawOutput,
      },
    }
  }
  const legacyMetadata = LegacyReviewMetadataSchema.safeParse({
    certificate: review.data.certificate,
    ...(parsedJson.value !== null
      && typeof parsedJson.value === "object"
      && !Array.isArray(parsedJson.value)
      && "blocking_issues" in parsedJson.value
      ? { blocking_issues: parsedJson.value.blocking_issues }
      : {}),
  })

  return {
    ok: true,
    kind: "review",
    adapter: "review_verdict_json",
    review: {
      verdict: normalizeLegacyVerdict(review.data.verdict),
      raw_report: rawOutput,
      ...(legacyMetadata.success ? { legacy_metadata: legacyMetadata.data } : {}),
    },
  }
}

export function adaptMarkdownReviewVerdict(rawOutput: string): AdapterResult {
  const declarations = collectMarkdownVerdicts(rawOutput)
  if (declarations.length === 0) {
    return verdictError("MISSING_VERDICT", "Markdown review must declare one verdict", rawOutput)
  }
  if (declarations.length > 1) {
    const verdicts = new Set(declarations)
    if (verdicts.size > 1) {
      return verdictError("CONFLICTING_VERDICTS", "Markdown review declares conflicting verdicts", rawOutput)
    }
    return verdictError("DUPLICATE_VERDICT", "Markdown review declares a verdict more than once", rawOutput)
  }

  const verdict = declarations[0]
  if (verdict === undefined) throw new TypeError("Expected one markdown verdict")
  return {
    ok: true,
    kind: "review",
    adapter: "review_verdict_markdown",
    review: { verdict, raw_report: rawOutput },
  }
}

function collectMarkdownVerdicts(rawOutput: string): CanonicalReviewVerdict[] {
  const verdicts: CanonicalReviewVerdict[] = []
  let activeFence: MarkdownFence | undefined
  for (const line of rawOutput.replace(/\r\n?/g, "\n").split("\n")) {
    const fence = parseMarkdownFence(line)
    if (activeFence !== undefined) {
      if (fence !== undefined && closesMarkdownFence(activeFence, fence)) activeFence = undefined
      continue
    }
    if (fence !== undefined) {
      activeFence = fence
      continue
    }
    switch (line) {
      case "VERDICT: PASS":
        verdicts.push("PASS")
        break
      case "VERDICT: REVISE":
        verdicts.push("REVISE")
        break
      case "VERDICT: INCONCLUSIVE":
        verdicts.push("INCONCLUSIVE")
        break
    }
  }
  return verdicts
}

type MarkdownFence = Readonly<{
  readonly marker: "`" | "~"
  readonly length: number
  readonly trailing: string
}>

function parseMarkdownFence(line: string): MarkdownFence | undefined {
  const match = /^[ \t]*(`{3,}|~{3,})(.*)$/.exec(line)
  if (!match) return undefined
  const markerText = match[1]
  const trailing = match[2]
  if (markerText === undefined || trailing === undefined) return undefined
  return {
    marker: markerText.startsWith("`") ? "`" : "~",
    length: markerText.length,
    trailing,
  }
}

function closesMarkdownFence(opening: MarkdownFence, candidate: MarkdownFence): boolean {
  return candidate.marker === opening.marker
    && candidate.length >= opening.length
    && candidate.trailing.trim().length === 0
}

function normalizeLegacyVerdict(verdict: "[CORRECT]" | "[ERROR]" | "[INCONCLUSIVE]"): CanonicalReviewVerdict {
  switch (verdict) {
    case "[CORRECT]":
      return "PASS"
    case "[ERROR]":
      return "REVISE"
    case "[INCONCLUSIVE]":
      return "INCONCLUSIVE"
  }
}

function invalidJsonError(rawOutput: string): AdapterResult {
  return {
    ok: false,
    error: {
      kind: "adapter_error",
      code: "INVALID_JSON",
      message: "Review output is not valid JSON",
      raw_output: rawOutput,
    },
  }
}

function verdictError(
  code: "MISSING_VERDICT" | "DUPLICATE_VERDICT" | "CONFLICTING_VERDICTS",
  message: string,
  rawOutput: string,
): AdapterResult {
  return { ok: false, error: { kind: "adapter_error", code, message, raw_output: rawOutput } }
}
