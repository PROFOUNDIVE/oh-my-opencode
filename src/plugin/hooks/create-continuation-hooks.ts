import type { HookName } from "../../config"
import type { BackgroundManager } from "../../features/background-agent"
import { createBackgroundNotificationHook } from "../../hooks"
import { safeCreateHook } from "../../shared/safe-create-hook"

export type ContinuationHooks = {
  backgroundNotificationHook: ReturnType<typeof createBackgroundNotificationHook> | null
}

export function createContinuationHooks(args: {
  isHookEnabled: (hookName: HookName) => boolean
  safeHookEnabled: boolean
  backgroundManager: BackgroundManager
}): ContinuationHooks {
  const { isHookEnabled, safeHookEnabled, backgroundManager } = args

  const safeHook = <T>(hookName: HookName, factory: () => T): T | null =>
    safeCreateHook(hookName, factory, { enabled: safeHookEnabled })

  const backgroundNotificationHook = isHookEnabled("background-notification")
    ? safeHook("background-notification", () => createBackgroundNotificationHook(backgroundManager))
    : null

  return {
    backgroundNotificationHook,
  }
}
