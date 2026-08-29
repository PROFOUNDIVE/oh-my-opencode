import type { CampaignApplicationResult } from "./campaign-application-result"
import type { CampaignMutationDependencies } from "./campaign-mutation-dependencies"
import { commitCampaignTransition } from "./commit-campaign-transition"
import { stateResultEnvelope } from "./state-result-envelope"

export async function abortResearchCampaign(input: Readonly<{
  readonly directory: string
  readonly campaign_id: string
  readonly expected_state_revision: number
  readonly reason?: string
}>, dependencies: CampaignMutationDependencies = {}): Promise<CampaignApplicationResult> {
  return stateResultEnvelope(await commitCampaignTransition({
    directory: input.directory,
    campaign_id: input.campaign_id,
    expected_state_revision: input.expected_state_revision,
    event: { type: "ABORT", reason: input.reason ?? null },
  }, dependencies))
}
