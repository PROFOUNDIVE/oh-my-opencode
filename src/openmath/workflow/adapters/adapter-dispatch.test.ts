import { createHash } from "node:crypto"
import { describe, expect, test } from "bun:test"

import { formatOpenMathArtifactsMarkdown } from "../../artifacts-markdown/format"
import { hashOpenMathArtifactsMarkdown } from "../../artifacts-markdown/hash"
import { adaptWorkflowOutput } from "./adapter-dispatch"

function createLegacyMarkdown(): string {
  return formatOpenMathArtifactsMarkdown({
    reference_solution: "Every square is nonnegative.",
    hint_ladder: {
      L1_nudge: "Use the definition of a square.",
      L2_key_theorem: "Squares of real numbers are nonnegative.",
      L3_skeleton: ["Choose a real number.", "Square it.", "Compare with zero."],
      L4_full_solution: "@REFERENCE_SOLUTION",
    },
    grading_rubric: {
      premises_check: ["The value is real."],
      logical_steps: ["Squares the value.", "Uses nonnegativity."],
      common_pitfalls: ["Assuming strict positivity."],
      key_theorem: "Square nonnegativity",
      key_technique: "Direct argument",
    },
    variant_problem: "Show that a fourth power is nonnegative.",
  })
}

describe("adaptWorkflowOutput", () => {
  test("formats and hashes legacy OMO sections through the existing parser path", () => {
    const rawOutput = createLegacyMarkdown().replace(/\n/g, "\r\n")

    const result = adaptWorkflowOutput({ adapter: "legacy_omo_sections", raw_output: rawOutput })

    expect(result.ok).toBe(true)
    if (!result.ok || result.adapter !== "legacy_omo_sections") {
      throw new Error("expected adapted legacy sections")
    }
    expect(result.adapter).toBe("legacy_omo_sections")
    expect(result.artifact.content).toBe(createLegacyMarkdown())
    expect(result.artifact.hash).toBe(hashOpenMathArtifactsMarkdown(createLegacyMarkdown()))
  })

  test("validates legacy JSON artifacts with the existing solver schema", () => {
    const rawOutput = JSON.stringify({
      reference_solution: "A solution",
      hint_ladder: { L1_nudge: "A hint" },
      grading_rubric: { key_theorem: "A theorem" },
      variant_problem: "A variant",
    })

    const result = adaptWorkflowOutput({ adapter: "legacy_json_artifacts", raw_output: rawOutput })

    expect(result.ok).toBe(true)
    if (!result.ok || result.adapter !== "legacy_json_artifacts") {
      throw new Error("expected adapted legacy JSON")
    }
    expect(result.adapter).toBe("legacy_json_artifacts")
    expect(result.artifacts.reference_solution).toBe("A solution")
  })

  test("normalizes opaque markdown and hashes its exact normalized bytes", () => {
    const rawOutput = "# Research notes\r\n\rA complete answer\r\r\n"
    const normalized = "# Research notes\n\nA complete answer\n"

    const result = adaptWorkflowOutput({ adapter: "opaque_markdown", raw_output: rawOutput })

    expect(result.ok).toBe(true)
    if (!result.ok || result.adapter !== "opaque_markdown") {
      throw new Error("expected adapted opaque markdown")
    }
    expect(result.adapter).toBe("opaque_markdown")
    expect(result.artifact.content).toBe(normalized)
    expect(result.artifact.hash).toBe(
      createHash("sha256").update(Buffer.from(normalized, "utf8")).digest("hex"),
    )
  })

  test("maps legacy JSON reviewer verdicts at the adapter boundary", () => {
    const rawOutput = JSON.stringify({
      verdict: "[ERROR]",
      certificate: {
        artifact_version: "v1",
        review_round: 1,
        timestamp: "2026-07-29T00:00:00.000Z",
      },
    })

    const result = adaptWorkflowOutput({ adapter: "review_verdict_json", raw_output: rawOutput })

    expect(result.ok).toBe(true)
    if (!result.ok || result.adapter !== "review_verdict_json") {
      throw new Error("expected adapted JSON review")
    }
    expect(result.adapter).toBe("review_verdict_json")
    expect(result.review.verdict).toBe("REVISE")
    expect(result.review.raw_report).toBe(rawOutput)
  })

  test("accepts one exact full-line markdown verdict", () => {
    const rawOutput = "Findings follow.\nVERDICT: INCONCLUSIVE\nMore detail."

    const result = adaptWorkflowOutput({ adapter: "review_verdict_markdown", raw_output: rawOutput })

    expect(result.ok).toBe(true)
    if (!result.ok || result.adapter !== "review_verdict_markdown") {
      throw new Error("expected adapted markdown review")
    }
    expect(result.adapter).toBe("review_verdict_markdown")
    expect(result.review.verdict).toBe("INCONCLUSIVE")
    expect(result.review.raw_report).toBe(rawOutput)
  })

  test("applies a JSON patch through the existing deterministic patch applier", () => {
    const baseMarkdown = createLegacyMarkdown()
    const rawOutput = JSON.stringify({
      base_hash: hashOpenMathArtifactsMarkdown(baseMarkdown),
      ops: [
        {
          op: "replace_section",
          section_id: "variant_problem",
          new_content: "Show that an even power is nonnegative.",
        },
      ],
    })

    const result = adaptWorkflowOutput({
      adapter: "patch_set_json",
      raw_output: rawOutput,
      base_markdown: baseMarkdown,
    })

    expect(result.ok).toBe(true)
    if (!result.ok || result.adapter !== "patch_set_json") {
      throw new Error("expected applied patch")
    }
    expect(result.adapter).toBe("patch_set_json")
    expect(result.artifact.content).toContain("Show that an even power is nonnegative.")
    expect(result.artifact.hash).toBe(hashOpenMathArtifactsMarkdown(result.artifact.content))
  })

  test("normalizes a full markdown replacement", () => {
    const result = adaptWorkflowOutput({
      adapter: "full_replace_markdown",
      raw_output: "# Replacement\rBody\r\n\n",
    })

    expect(result.ok).toBe(true)
    if (!result.ok || result.adapter !== "full_replace_markdown") {
      throw new Error("expected full replacement")
    }
    expect(result.adapter).toBe("full_replace_markdown")
    expect(result.artifact.content).toBe("# Replacement\nBody\n")
  })
})
