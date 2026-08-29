import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"

import { startWorkflowFromCurrentSources } from "../../openmath/workflow/application/start-workflow"
import { startWorkflowState } from "../../openmath/workflow/storage"
import type { ToolContextWithMetadata } from "../delegate-task/types"
import {
  jsonWorkflowError,
  jsonWorkflowException,
  jsonWorkflowSuccess,
  resolveInitialProfileSnapshot,
  resolveInitialReferenceSnapshot,
  resolveWorkflowRequest,
  type OpenMathWorkflowToolOptions,
} from "../openmath-workflow-shared"
import { OpenMathWorkflowStartInputSchema } from "./types"

export function createOpenMathWorkflowStartTool(options: OpenMathWorkflowToolOptions): ToolDefinition {
  return tool({
    description: "Start an immutable, resumable OpenMath workflow run.",
    args: OpenMathWorkflowStartInputSchema.shape,
    execute: async (rawArgs: Record<string, unknown>, context) => {
      try {
        const input = OpenMathWorkflowStartInputSchema.parse(rawArgs)
        const ctx = context as ToolContextWithMetadata
        const result = await startWorkflowFromCurrentSources(
          { run_id: input.run_id, parent_session_id: ctx.sessionID },
          {
            directory: options.directory,
            resolve_request: () => resolveWorkflowRequest(input.request, options.directory),
            resolve_profile: () => resolveInitialProfileSnapshot({
              config: options.openmathConfig,
              directory: options.directory,
              profile_name: input.workflow_profile,
              client: options.client,
              plugin_agents: options.pluginAgents,
            }),
            resolve_references: () => resolveInitialReferenceSnapshot({
              request_references: input.request.kind === "problem" ? input.request.supplementary_refs : undefined,
              reference_manifest_path: input.reference_manifest_path,
              config: options.openmathConfig,
              directory: options.directory,
            }),
            start_state: startWorkflowState,
          },
        )
        return result.kind === "ok" ? jsonWorkflowSuccess(result.state) : jsonWorkflowError(result)
      } catch (error) {
        return jsonWorkflowException(error)
      }
    },
  })
}
