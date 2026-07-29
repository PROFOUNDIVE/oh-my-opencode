import { describe, expect, test } from "bun:test"

import { OpenMathConfigSchema } from "../../config/schema"
import { resolveWorkflowProfileSnapshot, WorkflowModelStringSchema } from "./index"

const VALID_MODELS = [
  "openai/gpt-5.2",
  "open.ai/gpt-5.2",
  "provider+test/model_name:2026",
] as const

describe("workflow explicit model validation", () => {
  test.each(VALID_MODELS)("accepts valid provider/model ID %p", (model) => {
    // given
    const input = model

    // when
    const result = WorkflowModelStringSchema.safeParse(input)

    // then
    expect(result.success).toBe(true)
  })

  test("preserves a valid explicit model in the immutable snapshot", () => {
    // given
    const config = OpenMathConfigSchema.parse({
      default_workflow_profile: "nested-model",
      workflow_profiles: {
        "nested-model": {
          solve: {
            agent: "solver-markdown",
            model: "provider+test/model_name:2026",
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
    })

    // when
    const snapshot = resolveWorkflowProfileSnapshot({
      config,
      resolveAgentModel: (agent) => ({ providerID: "test-provider", modelID: agent }),
    })

    // then
    expect(snapshot.solve.model).toEqual({
      providerID: "provider+test",
      modelID: "model_name:2026",
    })
  })
})
