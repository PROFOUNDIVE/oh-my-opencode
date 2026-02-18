import type { HookName } from "./config"
import type { BackgroundManager } from "./features/background-agent"
import { createContinuationHooks } from "./plugin/hooks/create-continuation-hooks"

export type CreatedHooks = ReturnType<typeof createHooks>

export function createHooks(args: {
  backgroundManager: BackgroundManager
  isHookEnabled: (hookName: HookName) => boolean
  safeHookEnabled: boolean
}) {
  return createContinuationHooks({
    backgroundManager: args.backgroundManager,
    isHookEnabled: args.isHookEnabled,
    safeHookEnabled: args.safeHookEnabled,
  })
}
