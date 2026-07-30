import type { ToolDefinition } from "@opencode-ai/plugin"

import { OpenMathConfigSchema, type OhMyOpenCodeConfig } from "../config"
import type { PluginContext, ToolsRecord } from "./types"

import {
  createBackgroundTools,
  createLookAt,
  createDelegateTask,
  createOpenMathArtifactsTools,
  createOpenMathExportTool,
  createOpenMathSolveOnlyTool,
  createOpenMathStateTools,
  createOpenMathWorkflowTools,
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

  const openMathArtifactsTools = createOpenMathArtifactsTools({
    max_ops: pluginConfig.openmath?.artifacts?.patch?.max_ops ?? 20,
    allow_unique_substring_replace:
      pluginConfig.openmath?.artifacts?.patch?.allow_unique_substring_replace ?? true,
  })
  const openMathWorkflowTools = createOpenMathWorkflowTools({
    directory: ctx.directory,
    client: ctx.client,
    openmathConfig: pluginConfig.openmath ?? OpenMathConfigSchema.parse({}),
    pluginAgents: pluginConfig.agents,
  })

  const allTools: Record<string, ToolDefinition> = {
    ...createOpenMathStateTools(
      ctx.directory,
      pluginConfig.openmath
        ? {
            max_review_rounds: pluginConfig.openmath.max_review_rounds,
            state_filename_mode: pluginConfig.openmath.state_filename_mode,
          }
        : undefined,
    ),
    openmath_export: createOpenMathExportTool(ctx.directory, pluginConfig.openmath?.export),
    openmath_solve_only: createOpenMathSolveOnlyTool({
      directory: ctx.directory,
      client: ctx.client,
      openmathConfig: pluginConfig.openmath,
    }),
    ...openMathWorkflowTools,
    ...openMathArtifactsTools,
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
