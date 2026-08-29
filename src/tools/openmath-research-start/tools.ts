import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"

import { startResearchCampaign } from "../../openmath/research/application"
import { CampaignIdSchema, NonBlankSchema } from "../../openmath/research/state"
import type { ToolContextWithMetadata } from "../delegate-task/types"
import {
  resolveInitialReferenceSnapshot,
  resolveWorkflowRequest,
  WorkflowRequestV1Schema,
} from "../openmath-workflow-shared"
import {
  jsonResearchException,
  jsonResearchResult,
  type OpenMathResearchToolOptions,
} from "../openmath-research-shared"
import { resolveResearchProfileForTool } from "./research-profile-resolver"
import { OpenMathResearchStartInputSchema } from "./types"

export function createOpenMathResearchStartTool(
  options: OpenMathResearchToolOptions,
): ToolDefinition {
  return tool({
    description: "Start an isolated, revision-safe OpenMath research campaign.",
    args: {
      campaign_id: CampaignIdSchema,
      research_profile: NonBlankSchema.optional(),
      objective: WorkflowRequestV1Schema,
      reference_manifest_path: NonBlankSchema.optional(),
    },
    execute: async (rawArgs: Record<string, unknown>, context) => {
      try {
        const input = OpenMathResearchStartInputSchema.parse(rawArgs)
        const config = options.openmathConfig
        const ctx: ToolContextWithMetadata = context
        const references = () => resolveInitialReferenceSnapshot({
          request_references: input.objective.kind === "problem"
            ? input.objective.supplementary_refs
            : undefined,
          reference_manifest_path: input.reference_manifest_path,
          config,
          directory: options.directory,
        })
        const result = await startResearchCampaign({
          directory: options.directory,
          campaign_id: input.campaign_id,
          parent_session_id: ctx.sessionID,
        }, {
          resolve_objective: async () => (
            await resolveWorkflowRequest(input.objective, options.directory)
          ).snapshot,
          resolve_references: async () => references(),
          resolve_profile: async (resolvedReferences) => resolveResearchProfileForTool({
            config,
            directory: options.directory,
            research_profile: input.research_profile,
            references: resolvedReferences,
            client: options.client,
            plugin_agents: options.pluginAgents,
          }),
        })
        return jsonResearchResult(result)
      } catch (error) {
        return jsonResearchException(error)
      }
    },
  })
}
