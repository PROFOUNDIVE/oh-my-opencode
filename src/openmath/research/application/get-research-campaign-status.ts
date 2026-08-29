import { readResearchCampaignState } from "../storage"
import { campaignErrorEnvelope, campaignSuccessEnvelope } from "./campaign-envelope"
import type { CampaignApplicationResult } from "./campaign-application-result"

export async function getResearchCampaignStatus(input: Readonly<{
  readonly directory: string
  readonly campaign_id: string
}>): Promise<CampaignApplicationResult> {
  const result = await readResearchCampaignState(input.directory, input.campaign_id)
  return result.kind === "ok" ? campaignSuccessEnvelope(result.state) : campaignErrorEnvelope(result)
}
