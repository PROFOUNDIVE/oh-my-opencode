import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"

import { amendResearchCampaign } from "../../openmath/research/application"
import {
  CampaignAmendmentScopeSchema,
  CampaignIdSchema,
  CampaignRevisionSchema,
  NonBlankSchema,
} from "../../openmath/research/state"
import {
  jsonResearchException,
  jsonResearchResult,
  type OpenMathResearchToolOptions,
} from "../openmath-research-shared"
import {
  OpenMathResearchAmendInputSchema,
  OpenMathResearchAmendmentKindSchema,
} from "./types"

export function createOpenMathResearchAmendTool(
  options: Pick<OpenMathResearchToolOptions, "directory">,
): ToolDefinition {
  return tool({
    description: "Add or retract a revision-checked Phase A research campaign amendment.",
    args: {
      campaign_id: CampaignIdSchema,
      expected_state_revision: CampaignRevisionSchema,
      operation: tool.schema.enum(["add", "retract"]),
      kind: OpenMathResearchAmendmentKindSchema.optional(),
      scope: CampaignAmendmentScopeSchema.optional(),
      content: NonBlankSchema.optional(),
      amendment_id: NonBlankSchema.optional(),
    },
    execute: async (rawArgs: Record<string, unknown>) => {
      try {
        const input = OpenMathResearchAmendInputSchema.parse(rawArgs)
        return jsonResearchResult(await amendResearchCampaign({
          ...input,
          directory: options.directory,
        }))
      } catch (error) {
        return jsonResearchException(error)
      }
    },
  })
}
