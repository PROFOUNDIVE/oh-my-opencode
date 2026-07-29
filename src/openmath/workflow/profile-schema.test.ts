import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { OpenMathConfigSchema } from "../../config/schema"
import { loadConfigFromPath, mergeConfigs } from "../../plugin-config"
import {
  createBuiltinWorkflowProfiles,
  resolveWorkflowProfileSnapshot,
} from "./index"

const BASE_ROLES = {
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

function profile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...BASE_ROLES,
    min_review_rounds: 1,
    max_review_rounds: 3,
    required_consecutive_passes: 1,
    checkpoint: "none",
    ...overrides,
  }
}

function resolveAgentModel(agent: string) {
  return { providerID: "test-provider", modelID: agent, variant: "fallback" }
}

describe("workflow profile schemas", () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "openmath-workflow-profile-"))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  test("selects immutable markdown and json legacy profiles from current defaults", () => {
    // given
    const markdownConfig = OpenMathConfigSchema.parse({ max_review_rounds: 7 })
    const jsonConfig = OpenMathConfigSchema.parse({
      max_review_rounds: 5,
      artifacts: { format: "json" },
    })

    // when
    const markdown = resolveWorkflowProfileSnapshot({
      config: markdownConfig,
      resolveAgentModel,
    })
    const json = resolveWorkflowProfileSnapshot({
      config: jsonConfig,
      resolveAgentModel,
    })

    // then
    expect(markdown.name).toBe("legacy-educational-markdown")
    expect(markdown.max_review_rounds).toBe(7)
    expect(markdown.solve.agent).toBe("solver-markdown")
    expect(markdown.solve.output_adapter).toBe("legacy_omo_sections")
    expect(markdown.review.agent).toBe("reference-reviewer-markdown")
    expect(markdown.revise.output_adapter).toBe("patch_set_json")
    expect(json.name).toBe("legacy-educational-json")
    expect(json.max_review_rounds).toBe(5)
    expect(json.solve.agent).toBe("solver")
    expect(json.solve.output_adapter).toBe("legacy_json_artifacts")
    expect(json.review.agent).toBe("reference-reviewer")
    expect(json.revise.agent).toBe("solver")
    expect(json.revise.output_adapter).toBe("legacy_json_artifacts")
    expect(Object.isFrozen(markdown)).toBe(true)
    expect(Object.isFrozen(markdown.solve)).toBe(true)
    expect(Object.isFrozen(createBuiltinWorkflowProfiles(3)["legacy-educational-markdown"])).toBe(true)
  })

  test("uses an explicit role model and resolves omitted models once", () => {
    // given
    const calls: string[] = []
    const config = OpenMathConfigSchema.parse({
      default_workflow_profile: "model-selection",
      workflow_profiles: {
        "model-selection": profile({
          solve: {
            ...BASE_ROLES.solve,
            model: "openai/gpt-5",
            variant: "high",
          },
        }),
      },
    })

    // when
    const snapshot = resolveWorkflowProfileSnapshot({
      config,
      resolveAgentModel: (agent) => {
        calls.push(agent)
        return resolveAgentModel(agent)
      },
    })

    // then
    expect(snapshot.solve.model).toEqual({ providerID: "openai", modelID: "gpt-5", variant: "high" })
    expect(snapshot.review.model).toEqual({
      providerID: "test-provider",
      modelID: "reference-reviewer-markdown",
      variant: "fallback",
    })
    expect(calls).toEqual(["reference-reviewer-markdown", "solver-markdown-patch"])
  })

  test("keeps the winning file prompt provenance immutable after its source changes", () => {
    // given
    const userDirectory = join(directory, "user")
    const projectDirectory = join(directory, "project")
    mkdirSync(userDirectory)
    mkdirSync(projectDirectory)
    writeFileSync(join(userDirectory, "prompt.md"), "USER_V1", "utf8")
    const projectPrompt = join(projectDirectory, "prompt.md")
    writeFileSync(projectPrompt, "PROJECT_V1", "utf8")
    const config = {
      openmath: {
        default_workflow_profile: "layered-profile",
        workflow_profiles: {
          "layered-profile": profile({
            solve: { ...BASE_ROLES.solve, prompt: { kind: "file", uri: "file://./prompt.md" } },
          }),
        },
      },
    }
    const userConfigPath = join(userDirectory, "oh-my-openmath.jsonc")
    const projectConfigPath = join(projectDirectory, "oh-my-openmath.jsonc")
    writeFileSync(userConfigPath, JSON.stringify(config), "utf8")
    writeFileSync(projectConfigPath, JSON.stringify(config), "utf8")
    const userConfig = loadConfigFromPath(userConfigPath, {})
    const projectConfig = loadConfigFromPath(projectConfigPath, {})
    if (!userConfig || !projectConfig) throw new Error("Expected parsed OpenMath workflow configs")
    const merged = mergeConfigs(userConfig, projectConfig)
    writeFileSync(projectPrompt, "PROJECT_V2", "utf8")

    // when
    if (!merged.openmath) throw new Error("Expected merged OpenMath config")
    const snapshot = resolveWorkflowProfileSnapshot({
      config: merged.openmath,
      resolveAgentModel,
    })
    const winningProfile = merged.openmath.workflow_profiles["layered-profile"]
    if (!winningProfile) throw new Error("Expected merged layered profile")
    winningProfile.solve.agent = "mutated-agent"

    // then
    expect(snapshot.solve.prompt).toEqual({
      kind: "file",
      original_uri: "file://./prompt.md",
      base_dir: projectDirectory,
      resolved_path: projectPrompt,
      canonical_path: projectPrompt,
      content: "PROJECT_V1",
      content_hash: "5163ca6870230dae014aae978f9fc71565efaea3611762e79928177717dbb0fe",
    })
    expect(Object.isFrozen(snapshot.solve.prompt)).toBe(true)
    expect(snapshot.solve.agent).toBe("solver-markdown")
  })

  test("accepts research-full-markdown only as a user profile shape", () => {
    // given
    const config = OpenMathConfigSchema.parse({
      default_workflow_profile: "research-full-markdown",
      workflow_profiles: {
        "research-full-markdown": profile({
          solve: {
            ...BASE_ROLES.solve,
            prompt: { kind: "file", uri: "file://./SOLVER_MARKDOWN.md" },
            output_adapter: "opaque_markdown",
          },
          review: {
            ...BASE_ROLES.review,
            prompt: { kind: "file", uri: "file://./REFERENCE_REVIEWER.md" },
            output_adapter: "review_verdict_markdown",
          },
          revise: {
            ...BASE_ROLES.revise,
            prompt: { kind: "file", uri: "file://./SOLVER_MARKDOWN_PATCH.md" },
            output_adapter: "full_replace_markdown",
          },
          checkpoint: "after_review",
        }),
      },
    })

    // when
    const builtins = createBuiltinWorkflowProfiles(3)

    // then
    expect(Object.hasOwn(builtins, "research-full-markdown")).toBe(false)
    expect(config.workflow_profiles["research-full-markdown"]?.checkpoint).toBe("after_review")
  })

})
