import { describe, expect, test } from "bun:test"

import { formatOpenMathArtifactsMarkdown } from "../../artifacts-markdown/format"
import { hashOpenMathArtifactsMarkdown } from "../../artifacts-markdown/hash"
import { adaptWorkflowOutput } from "./adapter-dispatch"

function createLegacyMarkdown(referenceSolution = "Every square is nonnegative."): string {
  return formatOpenMathArtifactsMarkdown({
    reference_solution: referenceSolution,
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

function patchOutput(baseMarkdown: string, ops: unknown[]): string {
  return JSON.stringify({ base_hash: hashOpenMathArtifactsMarkdown(baseMarkdown), ops })
}

describe("legacy adapter candidate compatibility", () => {
  test("accepts a wrapped OMO candidate accepted by the solve-only extractor", () => {
    const markdown = createLegacyMarkdown()
    const rawOutput = `I will provide the artifact.\n\n\`\`\`markdown\n${markdown}\`\`\`\n\nEnd of response.`

    const result = adaptWorkflowOutput({ adapter: "legacy_omo_sections", raw_output: rawOutput })

    expect(result.ok).toBe(true)
    if (!result.ok || result.adapter !== "legacy_omo_sections") {
      throw new Error("expected extracted legacy OMO candidate")
    }
    expect(result.artifact.content).toBe(markdown)
  })

  test("accepts a wrapped fenced patch candidate accepted by solve-only", () => {
    const baseMarkdown = createLegacyMarkdown()
    const patch = patchOutput(baseMarkdown, [
      {
        op: "replace_section",
        section_id: "variant_problem",
        new_content: "Show that a sixth power is nonnegative.",
      },
    ])
    const rawOutput = `analysis\n<|end|>\n\`\`\`json\n${patch}\n\`\`\`\ncompleted`

    const result = adaptWorkflowOutput({
      adapter: "patch_set_json",
      raw_output: rawOutput,
      base_markdown: baseMarkdown,
    })

    expect(result.ok).toBe(true)
    if (!result.ok || result.adapter !== "patch_set_json") {
      throw new Error("expected extracted patch candidate")
    }
    expect(result.artifact.content).toContain("Show that a sixth power is nonnegative.")
  })

  test("keeps the legacy default maximum patch operations", () => {
    const baseMarkdown = createLegacyMarkdown()
    const rawOutput = patchOutput(baseMarkdown, [
      { op: "replace_section", section_id: "variant_problem", new_content: "First replacement." },
      { op: "replace_section", section_id: "variant_problem", new_content: "Second replacement." },
    ])

    const result = adaptWorkflowOutput({
      adapter: "patch_set_json",
      raw_output: rawOutput,
      base_markdown: baseMarkdown,
    })

    expect(result.ok).toBe(true)
  })

  test("forwards a configured maximum patch operation limit", () => {
    const baseMarkdown = createLegacyMarkdown()
    const rawOutput = patchOutput(baseMarkdown, [
      { op: "replace_section", section_id: "variant_problem", new_content: "First replacement." },
      { op: "replace_section", section_id: "variant_problem", new_content: "Second replacement." },
    ])

    const result = adaptWorkflowOutput({
      adapter: "patch_set_json",
      raw_output: rawOutput,
      base_markdown: baseMarkdown,
      patch_options: { max_ops: 1 },
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected configured operation limit failure")
    expect(result.error).toMatchObject({ code: "PATCH_APPLY_FAILED", raw_output: rawOutput })
  })

  test("keeps unique substring replacement enabled by default", () => {
    const baseMarkdown = createLegacyMarkdown("UNIQUE_REFERENCE_0123456789 is nonnegative.")
    const rawOutput = patchOutput(baseMarkdown, [
      {
        op: "replace_unique_substring",
        section_id: "reference_solution",
        old: "UNIQUE_REFERENCE_0123456789",
        new: "REPLACED_REFERENCE_0123456789",
      },
    ])

    const result = adaptWorkflowOutput({
      adapter: "patch_set_json",
      raw_output: rawOutput,
      base_markdown: baseMarkdown,
    })

    expect(result.ok).toBe(true)
  })

  test("forwards configured unique substring replacement policy", () => {
    const baseMarkdown = createLegacyMarkdown("UNIQUE_REFERENCE_0123456789 is nonnegative.")
    const rawOutput = patchOutput(baseMarkdown, [
      {
        op: "replace_unique_substring",
        section_id: "reference_solution",
        old: "UNIQUE_REFERENCE_0123456789",
        new: "REPLACED_REFERENCE_0123456789",
      },
    ])

    const result = adaptWorkflowOutput({
      adapter: "patch_set_json",
      raw_output: rawOutput,
      base_markdown: baseMarkdown,
      patch_options: { allow_unique_substring_replace: false },
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected configured substring policy failure")
    expect(result.error).toMatchObject({ code: "PATCH_APPLY_FAILED", raw_output: rawOutput })
  })
})
