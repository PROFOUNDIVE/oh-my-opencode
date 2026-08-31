import { parseFrozenCandidateSources } from "../candidates/frozen-candidate-sources"
import type { ResearchCampaignStateV1 } from "../state"
import { campaignSuccessEnvelope } from "./campaign-envelope"
import type { PublicCampaignApplicationResult } from "./campaign-application-result"
import { enabledCampaignSuccessEnvelope, type EnabledCertificationRead } from "./enabled-campaign-envelope"

export function certificationEnabled(campaign: ResearchCampaignStateV1): boolean {
  const frozen = parseFrozenCandidateSources(campaign)
  return frozen.ok && frozen.sources.profile.certification !== undefined
}

export function campaignLifecycleEnvelope(
  campaign: ResearchCampaignStateV1,
  certification: EnabledCertificationRead = { kind: "not_started" },
): PublicCampaignApplicationResult {
  return certificationEnabled(campaign)
    ? enabledCampaignSuccessEnvelope(campaign, certification)
    : campaignSuccessEnvelope(campaign)
}
