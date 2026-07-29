import { describe, expect, test } from "bun:test"

import { OpenMathConfigSchema } from "./schema"

describe("OpenMath workflow config", () => {
  test("preserves legacy defaults without workflow profiles", () => {
    // given
    const input = {}

    // when
    const result = OpenMathConfigSchema.parse(input)

    // then
    expect(result.artifacts.format).toBe("markdown")
    expect(result.max_review_rounds).toBe(3)
    expect(result.workflow_profiles).toEqual({})
    expect(result.workflow_allowed_roots).toEqual(["."])
  })

  test("accepts named workflow profiles with exact role settings", () => {
    // given
    const input = {
      default_workflow_profile: "custom-review",
      workflow_profiles: {
        "custom-review": {
          solve: {
            agent: "solver-markdown",
            prompt: { kind: "builtin" },
            output_adapter: "legacy_omo_sections",
          },
          review: {
            agent: "reference-reviewer-markdown",
            prompt: { kind: "builtin" },
            output_adapter: "review_verdict_json",
          },
          revise: {
            agent: "solver-markdown-patch",
            prompt: { kind: "builtin" },
            output_adapter: "patch_set_json",
          },
          min_review_rounds: 1,
          max_review_rounds: 3,
          required_consecutive_passes: 1,
          checkpoint: "none",
        },
      },
    }

    // when
    const result = OpenMathConfigSchema.safeParse(input)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.default_workflow_profile).toBe("custom-review")
      expect(result.data.workflow_profiles["custom-review"]?.solve.output_adapter).toBe(
        "legacy_omo_sections",
      )
    }
  })
})
