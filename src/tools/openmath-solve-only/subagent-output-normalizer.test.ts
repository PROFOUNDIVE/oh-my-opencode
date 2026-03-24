import { describe, expect, test } from "bun:test"

import {
  extractNormalizedMarkdownArtifacts,
  extractNormalizedJsonPayload,
} from "./subagent-output-normalizer"
import { extractParserValidatedMarkdownCandidate } from "./markdown-candidate-extractor"
import { extractSchemaValidatedJsonCandidate } from "./json-candidate-extractor"
import {
  ReviewerMarkdownOutputSchema,
  ReviewerPatchOutputSchema,
} from "./subagent-output-schemas"
import { formatOpenMathArtifactsMarkdown } from "../../openmath/artifacts-markdown/format"
import type { OpenMathArtifactsDraft } from "../../openmath/artifacts-markdown/types"

function createCanonicalDraft(): OpenMathArtifactsDraft {
  return {
    reference_solution: "Let x = 1.\nThen x^2 = 1.",
    hint_ladder: {
      L1_nudge: "Try evaluating at a simple value.",
      L2_key_theorem: "What definition links x and x^2?",
      L3_skeleton: ["Choose a value", "Compute x^2", "Compare"],
      L4_full_solution: "@REFERENCE_SOLUTION",
    },
    grading_rubric: {
      premises_check: ["Uses a valid substitution"],
      logical_steps: ["Computes x", "Computes x^2", "Concludes equality"],
      common_pitfalls: ["Arithmetic mistake"],
      key_theorem: "Definition of exponentiation",
      key_technique: "Direct computation",
    },
    variant_problem: "Compute x^3 when x = 2.",
  }
}

describe("subagent output normalizer", () => {
  test("extracts markdown artifacts block after tool-call noise", () => {
    const noisy = [
      '{"tool":"Read","path":"@book/Merged_Differential_Geometry.md"}',
      '{"tool":"Grep","pattern":"principal patch"}<|end of text|>',
      "",
      "<!-- OMO:SECTION reference_solution -->",
      "Proof sketch",
      "<!-- OMO:ENDSECTION -->",
      "<!-- OMO:SECTION hint_ladder -->",
      "### L1_nudge",
      "n",
      "### L2_key_theorem",
      "t",
      "### L3_skeleton",
      "- s1",
      "### L4_full_solution",
      "@REFERENCE_SOLUTION",
      "<!-- OMO:ENDSECTION -->",
      "<!-- OMO:SECTION grading_rubric -->",
      "### premises_check",
      "- p",
      "### logical_steps",
      "- l",
      "### common_pitfalls",
      "- c",
      "### key_theorem",
      "k",
      "### key_technique",
      "m",
      "<!-- OMO:ENDSECTION -->",
      "<!-- OMO:SECTION variant_problem -->",
      "v",
      "<!-- OMO:ENDSECTION -->",
      "<|end_of_turn|>",
    ].join("\n")

    const normalized = extractNormalizedMarkdownArtifacts(noisy)

    expect(normalized).not.toBeNull()
    expect(normalized!.startsWith("<!-- OMO:SECTION reference_solution -->")).toBe(true)
    expect(normalized!.includes('{"tool":"Read"')).toBe(false)
    expect(normalized!.includes("<|end")).toBe(false)
  })

  test("extracts final reviewer JSON payload after tool-call noise", () => {
    const noisy = [
      '{"tool":"Read","path":"@book/Merged_Differential_Geometry.md"}',
      '{"tool":"Glob","pattern":"**/Merged_Differential_Geometry.md"}<|end of text|>',
      "random prose",
      '{"verdict":"[ERROR]","blocking_issues":[{"location":"reference_solution:step 1","type":"logic_error","fix_direction":"fix","evidence":"e"}],"checks_performed":["logic"],"certificate":{"artifact_version":"v1","review_round":2,"timestamp":"1970-01-01T00:00:00.000Z"},"base_hash":"abc"}',
    ].join("\n")

    const normalized = extractNormalizedJsonPayload(noisy)

    expect(normalized).not.toBeNull()
    expect(normalized).toContain('"verdict":"[ERROR]"')
    expect(normalized).not.toContain('{"tool":"Read"')
    expect(normalized).not.toContain("<|end")
  })

  test("returns null when no canonical payload can be recovered", () => {
    const noisy = [
      "tool output",
      '<|end of text|>',
      "narration only",
    ].join("\n")

    expect(extractNormalizedMarkdownArtifacts(noisy)).toBeNull()
    expect(extractNormalizedJsonPayload(noisy)).toBeNull()
  })

  test("selects the first parser-valid canonical markdown candidate from noisy output", () => {
    const validCanonical = formatOpenMathArtifactsMarkdown(createCanonicalDraft())
    const malformedCandidate = [
      "<!-- OMO:SECTION reference_solution -->",
      "broken",
      "<!-- OMO:ENDSECTION -->",
    ].join("\n")

    const contaminated = [
      '{"tool":"Read","path":"@book.md"}<|end|>',
      malformedCandidate,
      "random text",
      validCanonical,
      "more trailing narration",
    ].join("\n")

    const result = extractParserValidatedMarkdownCandidate(contaminated)

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error("expected parser-valid markdown candidate")
    }

    expect(result.value).toBe(validCanonical)
    expect(result.attempts).toBeGreaterThan(1)
    expect(result.selected_candidate_index).toBeGreaterThanOrEqual(0)
  })

  test("returns structured parse failure when all markdown candidates are malformed", () => {
    const contaminated = [
      "<!-- OMO:SECTION reference_solution -->",
      "missing required sections",
      "<!-- OMO:ENDSECTION -->",
      "<!-- OMO:SECTION reference_solution -->",
      "still malformed",
      "<!-- OMO:ENDSECTION -->",
    ].join("\n")

    const result = extractParserValidatedMarkdownCandidate(contaminated)

    expect(result.ok).toBe(false)
    if (result.ok) {
      throw new Error("expected parser failure")
    }

    expect(result.stage).toBe("parse")
    expect(result.error_code).toBe("ARTIFACTS_PARSE_ERROR")
    expect(result.attempts).toBeGreaterThan(0)
  })

  test("selects schema-valid reviewer JSON candidate from contaminated output", () => {
    const contaminated = [
      "reviewing...",
      '{"tool":"Read","path":"@solution.md"}<|end|>',
      '{"verdict":"[ERROR]","certificate":{"artifact_version":"v1","review_round":1,"timestamp":"2024-01-01T00:00:00.000Z"}}',
      '{"verdict":"[ERROR]","blocking_issues":[{"location":"step 1","type":"logic_error","fix_direction":"fix","evidence":"bad step"}],"checks_performed":["logic"],"certificate":{"artifact_version":"v1","review_round":1,"timestamp":"2024-01-01T00:00:00.000Z"},"base_hash":"hash-1"}',
    ].join("\n")

    const result = extractSchemaValidatedJsonCandidate({
      text: contaminated,
      validate: (value) => {
        const parsed = ReviewerMarkdownOutputSchema.safeParse(value)
        if (parsed.success) return { success: true as const, data: parsed.data }
        return { success: false as const, message: "Reviewer markdown output schema validation failed" }
      },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error("expected schema-valid reviewer JSON")
    }

    expect(result.value.verdict).toBe("[ERROR]")
    expect(result.value.base_hash).toBe("hash-1")
    expect(result.attempts).toBeGreaterThan(0)
  })

  test("returns structured schema failure for parseable but invalid patch JSON", () => {
    const contaminated = [
      '{"tool":"Read","path":"@patch.md"}<|end|>',
      '{"verdict":"[CORRECT]","certificate":{"artifact_version":"v1","review_round":1,"timestamp":"2024-01-01T00:00:00.000Z"},"base_hash":"hash-2"}',
    ].join("\n")

    const result = extractSchemaValidatedJsonCandidate({
      text: contaminated,
      validate: (value) => {
        const parsed = ReviewerPatchOutputSchema.safeParse(value)
        if (parsed.success) return { success: true as const, data: parsed.data }
        return { success: false as const, message: "Patch output schema validation failed" }
      },
    })

    expect(result.ok).toBe(false)
    if (result.ok) {
      throw new Error("expected schema failure")
    }

    expect(result.stage).toBe("schema")
    expect(result.error_code).toBe("JSON_SCHEMA_INVALID")
    expect(result.attempts).toBeGreaterThan(0)
  })
})
