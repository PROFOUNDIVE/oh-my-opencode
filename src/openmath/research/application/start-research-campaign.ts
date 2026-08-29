import { z } from "zod"

import type { ReferenceSnapshot } from "../../references/types"
import type { WorkflowRequestSnapshot } from "../../workflow/state"
import { ResearchProfileResolutionError, type ResearchProfileSnapshot } from "../profile-snapshot"
import { startResearchCampaignState, type ResearchCampaignMutationResult } from "../storage"
import { buildCampaignSourceSnapshot } from "./build-campaign-source-snapshot"
import { campaignErrorEnvelope, campaignSuccessEnvelope } from "./campaign-envelope"
import type { CampaignApplicationResult } from "./campaign-application-result"
import { CampaignSourceResolutionError } from "./campaign-source-resolution-error"
import { createInitialCampaignState } from "./create-initial-campaign-state"

type StartResearchCampaignDependencies = Readonly<{
  readonly resolve_objective: () => Promise<WorkflowRequestSnapshot>
  readonly resolve_references: () => Promise<ReferenceSnapshot>
  readonly resolve_profile: (references: ReferenceSnapshot) => Promise<ResearchProfileSnapshot>
  readonly start_state?: (request: Readonly<{ readonly directory: string; readonly state: ReturnType<typeof createInitialCampaignState> }>) => Promise<ResearchCampaignMutationResult>
}>

export async function startResearchCampaign(input: Readonly<{
  readonly directory: string
  readonly campaign_id: string
  readonly parent_session_id: string
}>, dependencies: StartResearchCampaignDependencies): Promise<CampaignApplicationResult> {
  try {
    const objective = await dependencies.resolve_objective()
    const references = await dependencies.resolve_references()
    const profile = await dependencies.resolve_profile(references)
    const state = createInitialCampaignState({
      campaign_id: input.campaign_id,
      parent_session_id: input.parent_session_id,
      source_snapshot: buildCampaignSourceSnapshot({ objective, profile, references }),
    })
    const result = await (dependencies.start_state ?? startResearchCampaignState)({ directory: input.directory, state })
    return result.kind === "ok" ? campaignSuccessEnvelope(result.state) : campaignErrorEnvelope(result)
  } catch (error) {
    if (error instanceof ResearchProfileResolutionError) {
      const error_code = error.code === "PROFILE_NOT_FOUND" ? "PROFILE_NOT_FOUND" : error.code === "SOURCE_ERROR" ? "SOURCE_ERROR" : "VALIDATION_ERROR"
      return campaignErrorEnvelope({ error_code, message: error.message })
    }
    if (error instanceof z.ZodError) {
      return campaignErrorEnvelope({ error_code: "VALIDATION_ERROR", message: error.message })
    }
    if (error instanceof CampaignSourceResolutionError) {
      return campaignErrorEnvelope({ error_code: "SOURCE_ERROR", message: error.message })
    }
    throw error
  }
}
