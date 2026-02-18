import type { OhMyOpenCodeConfig } from "../config"
import type { PluginContext } from "./types"

import {
  applyAgentVariant,
  resolveAgentVariant,
  resolveVariantForModel,
} from "../shared/agent-variant"
import { hasConnectedProvidersCache } from "../shared"
import {
  setSessionAgent,
} from "../features/claude-code-session-state"

import type { CreatedHooks } from "../create-hooks"

type FirstMessageVariantGate = {
  shouldOverride: (sessionID: string) => boolean
  markApplied: (sessionID: string) => void
}

type ChatMessagePart = { type: string; text?: string; [key: string]: unknown }
type ChatMessageHandlerOutput = { message: Record<string, unknown>; parts: ChatMessagePart[] }
export function createChatMessageHandler(args: {
  ctx: PluginContext
  pluginConfig: OhMyOpenCodeConfig
  firstMessageVariantGate: FirstMessageVariantGate
  hooks: CreatedHooks
}): (
  input: { sessionID: string; agent?: string; model?: { providerID: string; modelID: string } },
  output: ChatMessageHandlerOutput
) => Promise<void> {
  const { ctx, pluginConfig, firstMessageVariantGate, hooks } = args
  void hooks

  return async (
    input: { sessionID: string; agent?: string; model?: { providerID: string; modelID: string } },
    output: ChatMessageHandlerOutput
  ): Promise<void> => {
    if (input.agent) {
      setSessionAgent(input.sessionID, input.agent)
    }

    const message = output.message

    if (firstMessageVariantGate.shouldOverride(input.sessionID)) {
      if (message["variant"] === undefined) {
        const variant =
          input.model && input.agent
            ? resolveVariantForModel(pluginConfig, input.agent, input.model)
            : resolveAgentVariant(pluginConfig, input.agent)
        if (variant !== undefined) {
          message["variant"] = variant
        }
      }
      firstMessageVariantGate.markApplied(input.sessionID)
    } else {
      if (input.model && input.agent && message["variant"] === undefined) {
        const variant = resolveVariantForModel(pluginConfig, input.agent, input.model)
        if (variant !== undefined) {
          message["variant"] = variant
        }
      } else {
        applyAgentVariant(pluginConfig, input.agent, message)
      }
    }

    if (!hasConnectedProvidersCache()) {
      ctx.client.tui
        .showToast({
          body: {
            title: "⚠️ Provider Cache Missing",
            message:
              "Model filtering disabled. RESTART OpenCode to enable full functionality.",
            variant: "warning" as const,
            duration: 6000,
          },
        })
        .catch(() => {})
    }
  }
}
