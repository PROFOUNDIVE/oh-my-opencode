import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"

import { promoteResearchCampaign } from "../../openmath/research/application"
import {
  CampaignHashSchema,
  CampaignIdSchema,
  CampaignRevisionSchema,
} from "../../openmath/research/state"
import { CertificationRevisionSchema } from "../../openmath/research/certification/state/literals"
import type { ToolContextWithMetadata } from "../delegate-task/types"
import {
  jsonResearchException,
  jsonResearchResult,
  type OpenMathResearchToolOptions,
} from "../openmath-research-shared"
import { OpenMathResearchPromoteInputSchema } from "./types"

export function createOpenMathResearchPromoteTool(
  options: Pick<OpenMathResearchToolOptions, "directory">,
): ToolDefinition {
  return tool({
    description: "Record an explicit dossier decision ending at promotion-ready metadata or rejection.",
    args: {
      campaign_id: CampaignIdSchema,
      expected_state_revision: CampaignRevisionSchema,
      expected_certification_revision: CertificationRevisionSchema.optional(),
      dossier_sha256: CampaignHashSchema,
      decision: tool.schema.enum(["approve", "reject"]),
    },
    execute: async (rawArgs: Record<string, unknown>, context) => {
      try {
        const input = OpenMathResearchPromoteInputSchema.parse(rawArgs)
        const ctx: ToolContextWithMetadata = context
        return jsonResearchResult(await promoteResearchCampaign({
          ...input,
          directory: options.directory,
        }, {
          trusted_actor_receipt: {
            session_id: ctx.sessionID,
            message_id: ctx.messageID,
          },
        }))
      } catch (error) {
        return jsonResearchException(error)
      }
    },
  })
}
