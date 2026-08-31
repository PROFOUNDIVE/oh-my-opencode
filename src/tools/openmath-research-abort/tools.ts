import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"

import { abortResearchCampaign } from "../../openmath/research/application"
import {
  CampaignIdSchema,
  CampaignRevisionSchema,
  NonBlankSchema,
} from "../../openmath/research/state"
import { CertificationRevisionSchema } from "../../openmath/research/certification/state/literals"
import {
  jsonResearchException,
  jsonResearchResult,
  type OpenMathResearchToolOptions,
} from "../openmath-research-shared"
import { OpenMathResearchAbortInputSchema } from "./types"

export function createOpenMathResearchAbortTool(
  options: Pick<OpenMathResearchToolOptions, "directory">,
): ToolDefinition {
  return tool({
    description: "Revision-check and abort an OpenMath research campaign.",
    args: {
      campaign_id: CampaignIdSchema,
      expected_state_revision: CampaignRevisionSchema,
      expected_certification_revision: CertificationRevisionSchema.nullable().optional(),
      reason: NonBlankSchema.optional(),
    },
    execute: async (rawArgs: Record<string, unknown>) => {
      try {
        const input = OpenMathResearchAbortInputSchema.parse(rawArgs)
        return jsonResearchResult(await abortResearchCampaign({
          ...input,
          directory: options.directory,
        }))
      } catch (error) {
        return jsonResearchException(error)
      }
    },
  })
}
