import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"

import { stepResearchCampaign } from "../../openmath/research/application"
import { CampaignIdSchema, CampaignRevisionSchema } from "../../openmath/research/state"
import { CertificationRevisionSchema } from "../../openmath/research/certification/state/literals"
import type { ToolContextWithMetadata } from "../delegate-task/types"
import {
  jsonResearchException,
  jsonResearchResult,
  type OpenMathResearchToolOptions,
} from "../openmath-research-shared"
import { createOpenMathResearchStepDependencies } from "./step-dependencies"
import { OpenMathResearchStepInputSchema } from "./types"

export function createOpenMathResearchStepTool(
  options: Pick<
    OpenMathResearchToolOptions,
    "directory" | "client" | "createStepDependencies"
  >,
): ToolDefinition {
  return tool({
    description: "Execute one research campaign operation or continue to its next checkpoint.",
    args: {
      campaign_id: CampaignIdSchema,
      expected_state_revision: CampaignRevisionSchema,
      expected_certification_revision: CertificationRevisionSchema.nullable().optional(),
      mode: tool.schema.enum(["one_stage", "to_checkpoint"]).optional(),
    },
    execute: async (rawArgs: Record<string, unknown>, context) => {
      try {
        const input = OpenMathResearchStepInputSchema.parse(rawArgs)
        const ctx: ToolContextWithMetadata = context
        const dependencies = options.createStepDependencies?.(ctx)
          ?? createOpenMathResearchStepDependencies({ options, context: ctx })
        return jsonResearchResult(await stepResearchCampaign({
          directory: options.directory,
          campaign_id: input.campaign_id,
          expected_state_revision: input.expected_state_revision,
          ...("expected_certification_revision" in input
            ? { expected_certification_revision: input.expected_certification_revision }
            : {}),
          mode: input.mode ?? "one_stage",
        }, dependencies))
      } catch (error) {
        return jsonResearchException(error)
      }
    },
  })
}
