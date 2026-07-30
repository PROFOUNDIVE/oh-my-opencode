import type { PluginInput, ToolDefinition } from "@opencode-ai/plugin"
import type { BackgroundManager } from "../../features/background-agent"
import { createBackgroundCancel } from "./create-background-cancel"
import { createBackgroundOutput } from "./create-background-output"

export function createBackgroundTools(
  manager: BackgroundManager,
  client: PluginInput["client"],
): Record<string, ToolDefinition> {
  return {
    background_output: createBackgroundOutput(manager, client),
    background_cancel: createBackgroundCancel(manager, client),
  }
}
