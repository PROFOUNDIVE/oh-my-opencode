import type { OhMyOpenCodeConfig } from "../config"
import type { PluginContext } from "./types"

import {
  clearSessionAgent,
  getMainSessionID,
  setMainSession,
  updateSessionAgent,
} from "../features/claude-code-session-state"
import { resetMessageCursor } from "../shared"
import { lspManager } from "../tools"

import type { CreatedHooks } from "../create-hooks"
import type { Managers } from "../create-managers"
import { normalizeSessionStatusToIdle } from "./session-status-normalizer"
import { pruneRecentSyntheticIdles } from "./recent-synthetic-idles"

type FirstMessageVariantGate = {
  markSessionCreated: (sessionInfo: { id?: string; title?: string; parentID?: string } | undefined) => void
  clear: (sessionID: string) => void
}

export function createEventHandler(args: {
  ctx: PluginContext
  pluginConfig: OhMyOpenCodeConfig
  firstMessageVariantGate: FirstMessageVariantGate
  managers: Managers
  hooks: CreatedHooks
}): (input: { event: { type: string; properties?: Record<string, unknown> } }) => Promise<void> {
  const { ctx, firstMessageVariantGate, managers, hooks } = args
  void args.pluginConfig

  const dispatchToHooks = async (input: { event: { type: string; properties?: Record<string, unknown> } }): Promise<void> => {
    await Promise.resolve(hooks.backgroundNotificationHook?.event?.(input))
  }

  const recentSyntheticIdles = new Map<string, number>()
  const recentRealIdles = new Map<string, number>()
  const DEDUP_WINDOW_MS = 500

  return async (input): Promise<void> => {
    pruneRecentSyntheticIdles({
      recentSyntheticIdles,
      recentRealIdles,
      now: Date.now(),
      dedupWindowMs: DEDUP_WINDOW_MS,
    })

    if (input.event.type === "session.idle") {
      const sessionID = (input.event.properties as Record<string, unknown> | undefined)?.sessionID as string | undefined
      if (sessionID) {
        const emittedAt = recentSyntheticIdles.get(sessionID)
        if (emittedAt && Date.now() - emittedAt < DEDUP_WINDOW_MS) {
          recentSyntheticIdles.delete(sessionID)
          return
        }
        recentRealIdles.set(sessionID, Date.now())
      }
    }

    await dispatchToHooks(input)

    const syntheticIdle = normalizeSessionStatusToIdle(input)
    if (syntheticIdle) {
      const sessionID = (syntheticIdle.event.properties as Record<string, unknown>)?.sessionID as string
      const emittedAt = recentRealIdles.get(sessionID)
      if (emittedAt && Date.now() - emittedAt < DEDUP_WINDOW_MS) {
        recentRealIdles.delete(sessionID)
        return
      }
      recentSyntheticIdles.set(sessionID, Date.now())
      await dispatchToHooks(syntheticIdle)
    }

    const { event } = input
    const props = event.properties as Record<string, unknown> | undefined

    if (event.type === "session.created") {
      const sessionInfo = props?.info as
        | { id?: string; title?: string; parentID?: string }
        | undefined

      if (!sessionInfo?.parentID) {
        setMainSession(sessionInfo?.id)
      }

      firstMessageVariantGate.markSessionCreated(sessionInfo)
    }

    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined
      if (sessionInfo?.id === getMainSessionID()) {
        setMainSession(undefined)
      }

      if (sessionInfo?.id) {
        clearSessionAgent(sessionInfo.id)
        resetMessageCursor(sessionInfo.id)
        firstMessageVariantGate.clear(sessionInfo.id)
        await lspManager.cleanupTempDirectoryClients()
      }
    }

    if (event.type === "message.updated") {
      const info = props?.info as Record<string, unknown> | undefined
      const sessionID = info?.sessionID as string | undefined
      const agent = info?.agent as string | undefined
      const role = info?.role as string | undefined
      if (sessionID && agent && role === "user") {
        updateSessionAgent(sessionID, agent)
      }
    }

    if (event.type === "session.error") {
      return
    }
  }
}
