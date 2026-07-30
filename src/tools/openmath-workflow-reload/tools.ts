import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"

import {
  jsonWorkflowException,
  mutateWorkflowFromState,
  reloadProfileSnapshot,
  reloadReferenceSnapshot,
  type OpenMathWorkflowToolOptions,
} from "../openmath-workflow-shared"
import { OpenMathWorkflowReloadInputSchema } from "./types"

export function createOpenMathWorkflowReloadTool(options: OpenMathWorkflowToolOptions): ToolDefinition {
  return tool({
    description: "Explicitly reload selected persisted OpenMath workflow prompt or reference sources.",
    args: OpenMathWorkflowReloadInputSchema.shape,
    execute: async (rawArgs: Record<string, unknown>) => {
      try {
        const input = OpenMathWorkflowReloadInputSchema.parse(rawArgs)
        return await mutateWorkflowFromState({
          directory: options.directory,
          run_id: input.run_id,
          expected_state_revision: input.expected_state_revision,
          preflight_event: (state) => ({
            type: "RELOAD",
            ...(input.targets.includes("prompts") ? { profile_snapshot: state.profile_snapshot } : {}),
            ...(input.targets.includes("references") ? { reference_snapshot: state.reference_snapshot } : {}),
          }),
          build_event: async (state) => ({
            type: "RELOAD",
            ...(input.targets.includes("prompts") ? {
              profile_snapshot: reloadProfileSnapshot({ snapshot: state.profile_snapshot, config: options.openmathConfig, directory: options.directory }),
            } : {}),
            ...(input.targets.includes("references") ? {
              reference_snapshot: reloadReferenceSnapshot({ snapshot: state.reference_snapshot, config: options.openmathConfig, directory: options.directory }),
            } : {}),
          }),
        })
      } catch (error) {
        return jsonWorkflowException(error)
      }
    },
  })
}
