import type { OhMyOpenCodeConfig } from "./config"
import type { PluginContext, ToolsRecord } from "./plugin/types"
import type { Managers } from "./create-managers"

import { createToolRegistry } from "./plugin/tool-registry"

export type CreateToolsResult = {
  filteredTools: ToolsRecord
  taskSystemEnabled: boolean
}

export async function createTools(args: {
  ctx: PluginContext
  pluginConfig: OhMyOpenCodeConfig
  managers: Pick<Managers, "backgroundManager">
}): Promise<CreateToolsResult> {
  const { ctx, pluginConfig, managers } = args

  const { filteredTools, taskSystemEnabled } = createToolRegistry({
    ctx,
    pluginConfig,
    managers,
  })

  return {
    filteredTools,
    taskSystemEnabled,
  }
}
