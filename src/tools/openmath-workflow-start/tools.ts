import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"

import { createInitialWorkflowState } from "../../openmath/workflow/transitions"
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
        const request = await resolveWorkflowRequest(input.request, options.directory)
        const profile = await resolveInitialProfileSnapshot({
          config: options.openmathConfig,
          directory: options.directory,
          profile_name: input.workflow_profile,
          client: options.client,
          plugin_agents: options.pluginAgents,
        })
        const references = resolveInitialReferenceSnapshot({
          request_references: input.request.kind === "problem" ? input.request.supplementary_refs : undefined,
          reference_manifest_path: input.reference_manifest_path,
          config: options.openmathConfig,
          directory: options.directory,
        })
        const state = createInitialWorkflowState({
          run_id: input.run_id,
          parent_session_id: ctx.sessionID,
          request_snapshot: request.snapshot,
          profile_snapshot: profile,
          reference_snapshot: references,
          artifact: request.initial_artifact,
        })
        const result = await startWorkflowState({ directory: options.directory, state })
        return result.kind === "ok" ? jsonWorkflowSuccess(result.state) : jsonWorkflowError(result)
      } catch (error) {
        return jsonWorkflowException(error)
      }
    },
  })
}
