import type { OhMyOpenCodeConfig } from "./config"
import type { ModelCacheState } from "./plugin-state"
import type { PluginContext } from "./plugin/types"

import { BackgroundManager } from "./features/background-agent"
import { initTaskToastManager } from "./features/task-toast-manager"
import { createConfigHandler } from "./plugin-handlers"

export type Managers = {
  backgroundManager: BackgroundManager
  configHandler: ReturnType<typeof createConfigHandler>
}

export function createManagers(args: {
  ctx: PluginContext
  pluginConfig: OhMyOpenCodeConfig
  modelCacheState: ModelCacheState
  backgroundNotificationHookEnabled: boolean
}): Managers {
  const { ctx, pluginConfig, modelCacheState, backgroundNotificationHookEnabled } = args

  const backgroundManager = new BackgroundManager(
    ctx,
    pluginConfig.background_task,
    {
      enableParentSessionNotifications: backgroundNotificationHookEnabled,
    },
  )

  initTaskToastManager(ctx.client)

  const configHandler = createConfigHandler({
    ctx: { directory: ctx.directory, client: ctx.client },
    pluginConfig,
    modelCacheState,
  })

  return {
    backgroundManager,
    configHandler,
  }
}
