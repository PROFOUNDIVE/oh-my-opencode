import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"

import { getResearchCampaignStatus } from "../../openmath/research/application"
import { CampaignIdSchema } from "../../openmath/research/state"
import {
  jsonResearchException,
  jsonResearchResult,
  type OpenMathResearchToolOptions,
} from "../openmath-research-shared"
import { OpenMathResearchStatusInputSchema } from "./types"

export function createOpenMathResearchStatusTool(
  options: Pick<OpenMathResearchToolOptions, "directory">,
): ToolDefinition {
  return tool({
    description: "Read the persisted state and next actions of an OpenMath research campaign.",
    args: { campaign_id: CampaignIdSchema },
    execute: async (rawArgs: Record<string, unknown>) => {
      try {
        const input = OpenMathResearchStatusInputSchema.parse(rawArgs)
        return jsonResearchResult(await getResearchCampaignStatus({
          directory: options.directory,
          campaign_id: input.campaign_id,
        }))
      } catch (error) {
        return jsonResearchException(error)
      }
    },
  })
}
