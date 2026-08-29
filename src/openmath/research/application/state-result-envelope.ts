import { campaignErrorEnvelope, campaignSuccessEnvelope } from "./campaign-envelope"
import type { CampaignApplicationResult, CampaignStateResult } from "./campaign-application-result"

export function stateResultEnvelope(result: CampaignStateResult): CampaignApplicationResult {
  return result.kind === "ok" ? campaignSuccessEnvelope(result.state) : campaignErrorEnvelope(result)
}
