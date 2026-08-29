import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { OhMyOpenCodeConfig } from "../config"
import { OpenMathConfigSchema } from "../config/schema"
import { readWorkflowState } from "../openmath/workflow/storage"
import { createToolRegistry } from "./tool-registry"

type CreateToolRegistryArgs = Parameters<typeof createToolRegistry>[0]

function createMockConfig(overrides: Partial<OhMyOpenCodeConfig> = {}): OhMyOpenCodeConfig {
  return {
    disabled_agents: [],
    disabled_tools: [],
    categories: {},
    agents: {},
    ...overrides,
  } as unknown as OhMyOpenCodeConfig
}

function createMockArgs(pluginConfig: OhMyOpenCodeConfig, directory = process.cwd()): CreateToolRegistryArgs {
  return {
    ctx: {
      directory,
      client: {
        app: { agents: async () => ({ data: [{ name: "solver", mode: "subagent" }] }) },
        model: { list: async () => ({ data: [] }) },
      },
    } as unknown as CreateToolRegistryArgs["ctx"],
    pluginConfig,
    managers: {
      backgroundManager: {
        getTask: () => undefined,
        getAllDescendantTasks: () => [],
        cancelTask: async () => false,
      },
    } as unknown as CreateToolRegistryArgs["managers"],
  }
}

describe("createToolRegistry", () => {
  test("returns OpenMath minimal tool set with multimodal enabled", () => {
    const { filteredTools } = createToolRegistry(createMockArgs(createMockConfig()))
    expect(Object.keys(filteredTools).sort()).toEqual([
      "background_cancel",
      "background_output",
      "look_at",
      "openmath_artifacts_apply_patch",
      "openmath_artifacts_parse",
      "openmath_export",
      "openmath_research_abort",
      "openmath_research_amend",
      "openmath_research_promote",
      "openmath_research_start",
      "openmath_research_status",
      "openmath_research_step",
      "openmath_solve_only",
      "openmath_state_get",
      "openmath_state_reset",
      "openmath_state_set",
      "openmath_workflow_abort",
      "openmath_workflow_amend",
      "openmath_workflow_reload",
      "openmath_workflow_start",
      "openmath_workflow_status",
      "openmath_workflow_step",
      "task",
    ])
  })

  test("omits look_at when multimodal-looker is disabled", () => {
    const { filteredTools } = createToolRegistry(
      createMockArgs(createMockConfig({ disabled_agents: ["multimodal-looker"] })),
    )

    expect(Object.keys(filteredTools).sort()).toEqual([
      "background_cancel",
      "background_output",
      "openmath_artifacts_apply_patch",
      "openmath_artifacts_parse",
      "openmath_export",
      "openmath_research_abort",
      "openmath_research_amend",
      "openmath_research_promote",
      "openmath_research_start",
      "openmath_research_status",
      "openmath_research_step",
      "openmath_solve_only",
      "openmath_state_get",
      "openmath_state_reset",
      "openmath_state_set",
      "openmath_workflow_abort",
      "openmath_workflow_amend",
      "openmath_workflow_reload",
      "openmath_workflow_start",
      "openmath_workflow_status",
      "openmath_workflow_step",
      "task",
    ])
  })

  test("forwards agent overrides to workflow start model snapshots", async () => {
    const directory = mkdtempSync(join(tmpdir(), "openmath-workflow-registry-"))
    try {
      const openmath = OpenMathConfigSchema.parse({
        default_workflow_profile: "registry-profile",
        workflow_profiles: {
          "registry-profile": {
            solve: { agent: "solver", prompt: { kind: "inline", content: "solve" }, output_adapter: "opaque_markdown" },
            review: { agent: "reviewer", model: "openai/reviewer", prompt: { kind: "inline", content: "review" }, output_adapter: "review_verdict_markdown" },
            revise: { agent: "reviser", model: "openai/reviser", prompt: { kind: "inline", content: "revise" }, output_adapter: "full_replace_markdown" },
            min_review_rounds: 1,
            max_review_rounds: 2,
            required_consecutive_passes: 1,
            checkpoint: "none",
          },
        },
      })
      const { filteredTools } = createToolRegistry(createMockArgs(createMockConfig({
        openmath,
        agents: { solver: { model: "anthropic/claude-opus-4-6", variant: "max" } },
      }), directory))
      const start = filteredTools.openmath_workflow_start
      if (!start) throw new Error("Expected registered workflow start tool")

      const result = JSON.parse(await start.execute({
        run_id: "registry-model",
        request: { kind: "problem", source: { kind: "text", text: "Prove it." } },
      }, {
        sessionID: "parent",
        messageID: "message",
        agent: "test",
        abort: new AbortController().signal,
      }))
      const stored = await readWorkflowState(directory, "registry-model")

      expect(result).toMatchObject({ ok: true })
      expect(stored).toMatchObject({ kind: "ok" })
      if (stored.kind === "ok") {
        expect(stored.state.profile_snapshot.solve.model).toEqual({
          providerID: "anthropic",
          modelID: "claude-opus-4-6",
          variant: "max",
        })
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
