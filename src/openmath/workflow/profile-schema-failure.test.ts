import { describe, expect, test } from "bun:test"

import { OpenMathConfigSchema } from "../../config/schema"
import { resolveWorkflowProfileSnapshot, WorkflowProfileResolutionError } from "./index"

const VALID_ROLES = {
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
}

const INVALID_EXPLICIT_MODELS = [
  "openai//",
  "openai/ /gpt",
  "/model",
  "provider/",
  " provider/model",
  "provider/model ",
  "provider /model",
  "provider/model/name",
  "provider/\tmodel",
  "provider/model\n",
] as const

function profile(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    ...VALID_ROLES,
    min_review_rounds: 1,
    max_review_rounds: 3,
    required_consecutive_passes: 1,
    checkpoint: "none",
    ...overrides,
  }
}

function parseProfile(name: string, value: Record<string, unknown>) {
  return OpenMathConfigSchema.safeParse({ workflow_profiles: { [name]: value } })
}

describe("workflow profile schema failures", () => {
  test("rejects a profile name with whitespace", () => {
    // given
    const result = parseProfile("invalid profile", profile({}))

    // when
    const issue = result.success ? undefined : result.error.issues[0]

    // then
    expect(result.success).toBe(false)
    expect(issue?.path).toEqual(["workflow_profiles", "invalid profile"])
    expect(issue?.message).toBe("Workflow profile names must use lowercase letters, numbers, and hyphens")
  })

  test("rejects an adapter that cannot serve its role", () => {
    // given
    const result = parseProfile("custom-review", profile({
      review: { ...VALID_ROLES.review, output_adapter: "opaque_markdown" },
    }))

    // when
    const issue = result.success ? undefined : result.error.issues[0]

    // then
    expect(result.success).toBe(false)
    expect(issue?.path).toEqual(["workflow_profiles", "custom-review", "review", "output_adapter"])
    expect(issue?.message).toBe("REVIEW output_adapter must be review_verdict_json or review_verdict_markdown")
  })

  test("rejects an adapter that cannot serve SOLVE", () => {
    // given
    const result = parseProfile("custom-review", profile({
      solve: { ...VALID_ROLES.solve, output_adapter: "review_verdict_json" },
    }))

    // when
    const issue = result.success ? undefined : result.error.issues[0]

    // then
    expect(result.success).toBe(false)
    expect(issue?.path).toEqual(["workflow_profiles", "custom-review", "solve", "output_adapter"])
    expect(issue?.message).toBe(
      "SOLVE output_adapter must be legacy_omo_sections, legacy_json_artifacts, or opaque_markdown",
    )
  })

  test("rejects an adapter that cannot serve REVISE", () => {
    // given
    const result = parseProfile("custom-review", profile({
      revise: { ...VALID_ROLES.revise, output_adapter: "review_verdict_markdown" },
    }))

    // when
    const issue = result.success ? undefined : result.error.issues[0]

    // then
    expect(result.success).toBe(false)
    expect(issue?.path).toEqual(["workflow_profiles", "custom-review", "revise", "output_adapter"])
    expect(issue?.message).toBe(
      "REVISE output_adapter must be patch_set_json, full_replace_markdown, or legacy_json_artifacts",
    )
  })

  test("rejects role fields outside the exact contract", () => {
    // given
    const result = parseProfile("custom-review", profile({
      solve: { ...VALID_ROLES.solve, extra: true },
    }))

    // when
    const issue = result.success ? undefined : result.error.issues[0]

    // then
    expect(result.success).toBe(false)
    expect(issue?.path).toEqual(["workflow_profiles", "custom-review", "solve"])
    expect(issue?.message).toBe('Unrecognized key: "extra"')
  })

  test("rejects a variant without an explicit model", () => {
    // given
    const result = parseProfile("custom-review", profile({
      solve: { ...VALID_ROLES.solve, variant: "high" },
    }))

    // when
    const issue = result.success ? undefined : result.error.issues[0]

    // then
    expect(result.success).toBe(false)
    expect(issue?.path).toEqual(["workflow_profiles", "custom-review", "solve", "variant"])
    expect(issue?.message).toBe("variant requires an explicit model")
  })

  test("rejects a model with a blank provider segment", () => {
    // given
    const result = parseProfile("custom-review", profile({
      solve: { ...VALID_ROLES.solve, model: "/gpt-5" },
    }))

    // when
    const issue = result.success ? undefined : result.error.issues[0]

    // then
    expect(result.success).toBe(false)
    expect(issue?.path).toEqual(["workflow_profiles", "custom-review", "solve", "model"])
    expect(issue?.message).toBe("model must use nonblank provider/model segments")
  })

  test.each(INVALID_EXPLICIT_MODELS)("rejects malformed explicit model %p", (model) => {
    // given
    const result = parseProfile("custom-review", profile({
      solve: { ...VALID_ROLES.solve, model },
    }))

    // when
    const issue = result.success ? undefined : result.error.issues[0]

    // then
    expect(result.success).toBe(false)
    expect(issue?.path).toEqual(["workflow_profiles", "custom-review", "solve", "model"])
    expect(issue?.message).toBe("model must use nonblank provider/model segments")
  })

  test("rejects a malformed explicit model mutated after schema parsing", () => {
    // given
    const config = OpenMathConfigSchema.parse({
      default_workflow_profile: "custom-review",
      workflow_profiles: {
        "custom-review": profile({
          solve: { ...VALID_ROLES.solve, model: "openai/gpt-5.2" },
        }),
      },
    })
    const selectedProfile = config.workflow_profiles["custom-review"]
    if (!selectedProfile) throw new Error("Expected custom-review profile")
    selectedProfile.solve.model = "openai//"

    // when
    const resolve = () => resolveWorkflowProfileSnapshot({
      config,
      resolveAgentModel: (agent) => ({ providerID: "test-provider", modelID: agent }),
    })

    // then
    expect(resolve).toThrow(WorkflowProfileResolutionError)
    expect(resolve).toThrow("Workflow explicit model is invalid: custom-review.solve")
  })

  test("rejects stop policies whose minimum exceeds the maximum", () => {
    // given
    const result = parseProfile("custom-review", profile({ min_review_rounds: 4, max_review_rounds: 3 }))

    // when
    const issue = result.success ? undefined : result.error.issues[0]

    // then
    expect(result.success).toBe(false)
    expect(issue?.path).toEqual(["workflow_profiles", "custom-review", "min_review_rounds"])
    expect(issue?.message).toBe("min_review_rounds must not exceed max_review_rounds")
  })

  test("rejects stop policies whose consecutive pass bound exceeds the maximum", () => {
    // given
    const result = parseProfile("custom-review", profile({
      required_consecutive_passes: 4,
    }))

    // when
    const issue = result.success ? undefined : result.error.issues[0]

    // then
    expect(result.success).toBe(false)
    expect(issue?.path).toEqual(["workflow_profiles", "custom-review", "required_consecutive_passes"])
    expect(issue?.message).toBe("required_consecutive_passes must not exceed max_review_rounds")
  })

  test("rejects an inline prompt source with blank content", () => {
    // given
    const result = parseProfile("custom-review", profile({
      solve: { ...VALID_ROLES.solve, prompt: { kind: "inline", content: "   " } },
    }))

    // when
    const issue = result.success ? undefined : result.error.issues[0]

    // then
    expect(result.success).toBe(false)
    expect(issue?.path).toEqual(["workflow_profiles", "custom-review", "solve", "prompt", "content"])
    expect(issue?.message).toBe("Prompt content must not be blank")
  })

  test("rejects a file prompt source without a file URI", () => {
    // given
    const result = parseProfile("custom-review", profile({
      solve: { ...VALID_ROLES.solve, prompt: { kind: "file", uri: "https://example.test/prompt.md" } },
    }))

    // when
    const issue = result.success ? undefined : result.error.issues[0]

    // then
    expect(result.success).toBe(false)
    expect(issue?.path).toEqual(["workflow_profiles", "custom-review", "solve", "prompt", "uri"])
    expect(issue?.message).toBe("File prompt sources require a file:// URI")
  })
})
