import type { ToolDefinition } from "@opencode-ai/plugin"

import type { OhMyOpenCodeConfig } from "../config"
import type { PluginContext, ToolsRecord } from "./types"

import {
  createBackgroundTools,
  createLookAt,
  createDelegateTask,
  createOpenMathStateTools,
} from "../tools"
import { filterDisabledTools } from "../shared/disabled-tools"

import type { Managers } from "../create-managers"

export type ToolRegistryResult = {
  filteredTools: ToolsRecord
  taskSystemEnabled: boolean
}

export function createToolRegistry(args: {
  ctx: PluginContext
  pluginConfig: OhMyOpenCodeConfig
  managers: Pick<Managers, "backgroundManager">
}): ToolRegistryResult {
  const { ctx, pluginConfig, managers } = args

  const backgroundTools = createBackgroundTools(managers.backgroundManager, ctx.client)

  const isMultimodalLookerEnabled = !(pluginConfig.disabled_agents ?? []).some(
    (agent) => agent.toLowerCase() === "multimodal-looker",
  )
  const lookAt = isMultimodalLookerEnabled ? createLookAt(ctx) : null

  const delegateTask = createDelegateTask({
    manager: managers.backgroundManager,
    client: ctx.client,
    directory: ctx.directory,
    userCategories: pluginConfig.categories,
    agentOverrides: pluginConfig.agents,
    gitMasterConfig: pluginConfig.git_master,
    sisyphusJuniorModel: pluginConfig.agents?.["sisyphus-junior"]?.model,
  })

  const taskSystemEnabled = false

  const allTools: Record<string, ToolDefinition> = {
    ...createOpenMathStateTools(ctx.directory),
    ...backgroundTools,
    ...(lookAt ? { look_at: lookAt } : {}),
    task: delegateTask,
  }

  const filteredTools = filterDisabledTools(allTools, pluginConfig.disabled_tools)

  return {
    filteredTools,
    taskSystemEnabled,
  }
}
