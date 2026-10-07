import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import { getOpenMathStorageDirectory } from "../../openmath/storage-directory"

import { getResearchCampaignStatus } from "../../openmath/research/application"
import { CampaignIdSchema } from "../../openmath/research/state"
import {
  jsonResearchException,
  jsonResearchResult,
  type OpenMathResearchStorageOptions,
} from "../openmath-research-shared"
import { OpenMathResearchStatusInputSchema } from "./types"

export function createOpenMathResearchStatusTool(
  options: OpenMathResearchStorageOptions,
): ToolDefinition {
  const storageDirectory = getOpenMathStorageDirectory(options.directory, options.openmathConfig?.storage_root)
  return tool({
    description: "Read the persisted state and next actions of an OpenMath research campaign.",
    args: { campaign_id: CampaignIdSchema },
    execute: async (rawArgs: Record<string, unknown>) => {
      try {
        const input = OpenMathResearchStatusInputSchema.parse(rawArgs)
        return jsonResearchResult(await getResearchCampaignStatus({
          directory: storageDirectory,
          campaign_id: input.campaign_id,
        }))
      } catch (error) {
        return jsonResearchException(error)
      }
    },
  })
}
