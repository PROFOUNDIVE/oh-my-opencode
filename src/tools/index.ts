import type { PluginInput, ToolDefinition } from "@opencode-ai/plugin"
import type { BackgroundManager } from "../features/background-agent"

import { createBackgroundCancel, createBackgroundOutput } from "./background-task"
import { createDelegateTask } from "./delegate-task"
import { createLookAt } from "./look-at"
import { createOpenMathStateTools } from "./openmath-state"

import { lspManager } from "./lsp/lsp-server"
import { sessionExists } from "./session-manager/storage"
import { startBackgroundCheck as startTmuxCheck } from "./interactive-bash/tmux-path-resolver"

type OpencodeClient = PluginInput["client"]

export { createDelegateTask, createLookAt, createOpenMathStateTools }
export { lspManager, sessionExists, startTmuxCheck }

export function createBackgroundTools(manager: BackgroundManager, client: OpencodeClient): Record<string, ToolDefinition> {
  return {
    background_output: createBackgroundOutput(manager, client),
    background_cancel: createBackgroundCancel(manager, client),
  }
}
