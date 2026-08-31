import type { ResearchCampaignStateV1 } from "../state"
import type { CampaignErrorCode, CampaignErrorEnvelope, CampaignSuccessEnvelope } from "./campaign-envelope"
import type { EnabledCampaignErrorEnvelope } from "./enabled-campaign-error-envelope"
import type { EnabledCampaignSuccessEnvelope } from "./enabled-campaign-envelope"

export type CampaignApplicationResult =
  | CampaignSuccessEnvelope
  | CampaignErrorEnvelope

export type PublicCampaignApplicationResult =
  | CampaignApplicationResult
  | EnabledCampaignSuccessEnvelope
  | EnabledCampaignErrorEnvelope

export type CampaignStateResult =
  | { readonly kind: "ok"; readonly state: ResearchCampaignStateV1 }
  | {
      readonly kind: "error"
      readonly error_code: CampaignErrorCode
      readonly message: string
      readonly current_state_revision?: number
    }
