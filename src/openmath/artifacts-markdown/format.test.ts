import { describe, expect, test } from "bun:test"
import { formatOpenMathArtifactsMarkdown } from "./format"
import { parseOpenMathArtifactsMarkdown } from "./parse"
import { hashOpenMathArtifactsMarkdown } from "./hash"
import type { OpenMathArtifactsDraft } from "./types"

describe("formatOpenMathArtifactsMarkdown", () => {
  test("emits all section markers in a fixed order", () => {
    const draft: OpenMathArtifactsDraft = {
      reference_solution: "ref",
      hint_ladder: {
        L1_nudge: "nudge",
        L2_key_theorem: "tool",
        L3_skeleton: ["a"],
        L4_full_solution: "ref",
      },
      grading_rubric: {
        premises_check: ["p"],
        logical_steps: ["s"],
        common_pitfalls: ["c"],
        key_theorem: "t",
        key_technique: "k",
      },
      variant_problem: "variant",
    }

    const markdown = formatOpenMathArtifactsMarkdown(draft)

    const markers = [
      "<!-- OMO:SECTION reference_solution -->",
      "<!-- OMO:SECTION hint_ladder -->",
      "<!-- OMO:SECTION grading_rubric -->",
      "<!-- OMO:SECTION variant_problem -->",
    ]

    const indices = markers.map((m) => markdown.indexOf(m))
    for (const idx of indices) expect(idx).toBeGreaterThanOrEqual(0)
    for (let i = 1; i < indices.length; i++) expect(indices[i]).toBeGreaterThan(indices[i - 1])
  })

  test("canonicalizes L4_full_solution to @REFERENCE_SOLUTION", () => {
    const draft: OpenMathArtifactsDraft = {
      reference_solution: "same",
      hint_ladder: {
        L1_nudge: "n",
        L2_key_theorem: "t",
        L3_skeleton: ["s"],
        L4_full_solution: "same",
      },
      grading_rubric: {
        premises_check: ["p"],
        logical_steps: ["l"],
        common_pitfalls: ["c"],
        key_theorem: "kt",
        key_technique: "kk",
      },
      variant_problem: "v",
    }

    const markdown = formatOpenMathArtifactsMarkdown(draft)
    expect(markdown).toContain("### L4_full_solution\n@REFERENCE_SOLUTION\n")
    expect(markdown).not.toContain("### L4_full_solution\nsame\n")
  })

  test("format+parse roundtrip is stable", () => {
    const draft: OpenMathArtifactsDraft = {
      reference_solution: "Line 1\nLine 2",
      hint_ladder: {
        L1_nudge: "n",
        L2_key_theorem: "t",
        L3_skeleton: ["a", "b"],
        L4_full_solution: "@REFERENCE_SOLUTION",
      },
      grading_rubric: {
        premises_check: ["p1"],
        logical_steps: ["s1", "s2"],
        common_pitfalls: ["c1"],
        key_theorem: "theorem",
        key_technique: "technique",
      },
      variant_problem: "Variant",
    }

    const markdown1 = formatOpenMathArtifactsMarkdown(draft)
    const parsed = parseOpenMathArtifactsMarkdown(markdown1)
    expect(parsed.ok).toBe(true)
    if (parsed.ok === false) throw new Error("expected ok")

    const markdown2 = formatOpenMathArtifactsMarkdown(parsed.draft)
    expect(markdown2).toBe(markdown1)
  })

  test("hash is stable under normalization", () => {
    const draft: OpenMathArtifactsDraft = {
      reference_solution: "ref",
      hint_ladder: {
        L1_nudge: "n",
        L2_key_theorem: "t",
        L3_skeleton: ["a"],
        L4_full_solution: "ref",
      },
      grading_rubric: {
        premises_check: ["p"],
        logical_steps: ["s"],
        common_pitfalls: ["c"],
        key_theorem: "kt",
        key_technique: "kk",
      },
      variant_problem: "v",
    }

    const markdown = formatOpenMathArtifactsMarkdown(draft)
    const mutated = markdown.replace(/\n/g, "\r\n").replace(/\r\n/g, "  \r\n")
    expect(hashOpenMathArtifactsMarkdown(mutated)).toBe(hashOpenMathArtifactsMarkdown(markdown))
  })
})
