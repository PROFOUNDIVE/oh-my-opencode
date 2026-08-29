import { ResearchCampaignStateV1Schema, type ResearchCampaignStateV1 } from "../state"
import { createResearchCampaignStateFixture } from "../state/test-fixture"

export function createStoredResearchCampaignState(
  campaignId: string,
  revision: number,
): ResearchCampaignStateV1 {
  const fixture = createResearchCampaignStateFixture()
  return ResearchCampaignStateV1Schema.parse({
    ...fixture,
    campaign_id: campaignId,
    state_revision: revision,
    candidates: [],
    job_attempts: [],
  })
}
