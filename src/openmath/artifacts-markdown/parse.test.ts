import { describe, expect, test } from "bun:test"
import { formatOpenMathArtifactsMarkdown } from "./format"
import { parseOpenMathArtifactsMarkdown } from "./parse"
import type { OpenMathArtifactsDraft } from "./types"

function createDraft(overrides: Partial<OpenMathArtifactsDraft> = {}): OpenMathArtifactsDraft {
  const base: OpenMathArtifactsDraft = {
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
  return { ...base, ...overrides }
}

describe("parseOpenMathArtifactsMarkdown", () => {
  test("parses canonical formatted markdown", () => {
    const draft = createDraft()
    const markdown = formatOpenMathArtifactsMarkdown(draft)

    const result = parseOpenMathArtifactsMarkdown(markdown)
    expect(result.ok).toBe(true)
    if (result.ok === false) throw new Error("expected ok")

    expect(result.draft).toEqual(draft)
  })

  test("normalizes CRLF and trailing whitespace", () => {
    const draft = createDraft({
      reference_solution: "A line with spaces.   \r\nSecond line\t\r\n",
    })
    const markdown = formatOpenMathArtifactsMarkdown(draft)

    const crlf = markdown.replace(/\n/g, "\r\n").replace(/@REFERENCE_SOLUTION/g, "@REFERENCE_SOLUTION   ")
    const result = parseOpenMathArtifactsMarkdown(crlf)

    expect(result.ok).toBe(true)
    if (result.ok === false) throw new Error("expected ok")
    expect(result.normalizedMarkdown).toContain("@REFERENCE_SOLUTION")
    expect(result.normalizedMarkdown).not.toContain("@REFERENCE_SOLUTION   ")
  })

  test("rejects missing sections", () => {
    const markdown = [
      "<!-- OMO:SECTION reference_solution -->",
      "x",
      "<!-- OMO:ENDSECTION -->",
      "<!-- OMO:SECTION hint_ladder -->",
      "### L1_nudge\nhi\n\n### L2_key_theorem\nhi\n\n### L3_skeleton\n- a\n\n### L4_full_solution\n@REFERENCE_SOLUTION",
      "<!-- OMO:ENDSECTION -->",
      "<!-- OMO:SECTION variant_problem -->",
      "v",
      "<!-- OMO:ENDSECTION -->",
      "",
    ].join("\n")

    const result = parseOpenMathArtifactsMarkdown(markdown)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected error")
    expect(result.error.code).toBe("MISSING_SECTION")
    expect(result.error.section).toBe("grading_rubric")
  })

  test("rejects duplicate sections", () => {
    const draft = createDraft()
    const markdown = formatOpenMathArtifactsMarkdown(draft)
    const duplicated = `${markdown}<!-- OMO:SECTION reference_solution -->\nX\n<!-- OMO:ENDSECTION -->\n`

    const result = parseOpenMathArtifactsMarkdown(duplicated)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected error")
    expect(result.error.code).toBe("DUPLICATE_SECTION")
  })

  test("rejects unknown section ids", () => {
    const markdown = [
      "<!-- OMO:SECTION reference_solution -->",
      "x",
      "<!-- OMO:ENDSECTION -->",
      "<!-- OMO:SECTION hint_ladder -->",
      "### L1_nudge\nhi\n\n### L2_key_theorem\nhi\n\n### L3_skeleton\n- a\n\n### L4_full_solution\n@REFERENCE_SOLUTION",
      "<!-- OMO:ENDSECTION -->",
      "<!-- OMO:SECTION grading_rubric -->",
      "### premises_check\n- p\n\n### logical_steps\n- s\n\n### common_pitfalls\n- c\n\n### key_theorem\nkt\n\n### key_technique\nkk",
      "<!-- OMO:ENDSECTION -->",
      "<!-- OMO:SECTION variant_problem -->",
      "v",
      "<!-- OMO:ENDSECTION -->",
      "<!-- OMO:SECTION not_a_real_section -->",
      "oops",
      "<!-- OMO:ENDSECTION -->",
      "",
    ].join("\n")

    const result = parseOpenMathArtifactsMarkdown(markdown)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected error")
    expect(result.error.code).toBe("UNKNOWN_SECTION_ID")
  })

  test("rejects nested sections", () => {
    const draft = createDraft()
    const markdown = formatOpenMathArtifactsMarkdown(draft).replace(
      "Let x = 1.",
      "Let x = 1.\n<!-- OMO:SECTION hint_ladder -->",
    )

    const result = parseOpenMathArtifactsMarkdown(markdown)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected error")
    expect(result.error.code).toBe("NESTED_SECTION")
  })

  test("rejects missing hint_ladder keys", () => {
    const draft = createDraft()
    const markdown = formatOpenMathArtifactsMarkdown(draft).replace("### L2_key_theorem", "### X2_key")

    const result = parseOpenMathArtifactsMarkdown(markdown)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected error")
    expect(result.error.code).toBe("INVALID_SECTION_CONTENT")
  })

  test("rejects unexpected text outside sections", () => {
    const draft = createDraft()
    const markdown = formatOpenMathArtifactsMarkdown(draft)
    const withPreamble = `hello\n${markdown}`

    const result = parseOpenMathArtifactsMarkdown(withPreamble)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected error")
    expect(result.error.code).toBe("UNEXPECTED_TEXT_OUTSIDE_SECTIONS")
  })

  test("rejects invalid hint_ladder skeleton (non-bullets)", () => {
    const draft = createDraft()
    const markdown = formatOpenMathArtifactsMarkdown(draft).replace(/- Choose a value/, "Choose a value")

    const result = parseOpenMathArtifactsMarkdown(markdown)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected error")
    expect(result.error.code).toBe("INVALID_SECTION_CONTENT")
  })

  test("rejects L4_full_solution that doesn't match reference_solution", () => {
    const draft = createDraft({
      hint_ladder: {
        ...createDraft().hint_ladder,
        L4_full_solution: "not the reference",
      },
    })

    const markdown = formatOpenMathArtifactsMarkdown({
      ...draft,
      hint_ladder: { ...draft.hint_ladder, L4_full_solution: "@REFERENCE_SOLUTION" },
    }).replace("@REFERENCE_SOLUTION", "not the reference")

    const result = parseOpenMathArtifactsMarkdown(markdown)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected error")
    expect(result.error.code).toBe("INVALID_SECTION_CONTENT")
  })
})
