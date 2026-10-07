import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import { getOpenMathStorageDirectory } from "../../openmath/storage-directory"

import { educationalizeResearchCampaign } from "../../openmath/research/educationalization/educationalize-research-campaign"
import { resolveResearchEducationalizationProfile } from "../../openmath/research/educationalization/educationalization-profile"
import { createWorkflowStageRuntime } from "../../openmath/workflow/stage-runner"
import type { ToolContextWithMetadata } from "../delegate-task/types"
import { jsonResearchException, type OpenMathResearchToolOptions } from "../openmath-research-shared"
import { OpenMathResearchEducationalizeInputSchema } from "./types"

export function createOpenMathResearchEducationalizeTool(options: OpenMathResearchToolOptions): ToolDefinition {
  const storageDirectory = getOpenMathStorageDirectory(options.directory, options.openmathConfig.storage_root)
  return tool({
    description: "Explicitly generate, review, and freeze educational derivatives from an approved certified research result.",
    args: OpenMathResearchEducationalizeInputSchema.shape,
    execute: async (rawArgs: Record<string, unknown>, context) => {
      try {
        const input = OpenMathResearchEducationalizeInputSchema.parse(rawArgs)
        const ctx: ToolContextWithMetadata = context
        return JSON.stringify(await educationalizeResearchCampaign({
          ...input,
          directory: options.directory,
          storageDirectory,
          parent_session_id: ctx.sessionID,
        }, {
          resolve_profile: () => options.resolveEducationalizationProfile?.() ?? resolveResearchEducationalizationProfile({
            client: options.client,
            plugin_agents: options.pluginAgents,
            max_review_rounds: options.openmathConfig.max_review_rounds,
          }),
          create_runtime: (state) => options.createEducationalizationRuntime?.({ state, ctx })
            ?? (options.client === undefined ? undefined : createWorkflowStageRuntime({
              state,
              directory: options.directory,
              storageDirectory,
              client: options.client,
              ctx,
            })),
        }))
      } catch (error) {
        return jsonResearchException(error)
      }
    },
  })
}
