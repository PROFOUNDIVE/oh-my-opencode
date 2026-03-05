import { describe, expect, test } from "bun:test"

import type { OhMyOpenCodeConfig } from "../config"
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

function createMockArgs(pluginConfig: OhMyOpenCodeConfig): CreateToolRegistryArgs {
  return {
    ctx: {
      directory: process.cwd(),
      client: {
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
      "openmath_solve_only",
      "openmath_state_get",
      "openmath_state_reset",
      "openmath_state_set",
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
      "openmath_solve_only",
      "openmath_state_get",
      "openmath_state_reset",
      "openmath_state_set",
      "task",
    ])
  })
})
