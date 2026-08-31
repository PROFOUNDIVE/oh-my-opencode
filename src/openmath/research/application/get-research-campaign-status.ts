import { getResearchCertificationStatus } from "../certification/application/get-research-certification-status"
import type { CertificationApplicationDependencies } from "../certification/application/certification-application-dependencies"
import { readResearchCampaignState } from "../storage"
import { campaignErrorEnvelope, campaignSuccessEnvelope } from "./campaign-envelope"
import type { PublicCampaignApplicationResult } from "./campaign-application-result"
import { certificationEnabled } from "./campaign-lifecycle-envelope"
import { enabledCampaignErrorEnvelope } from "./enabled-campaign-error-envelope"
import { enabledCampaignAnomalyEnvelope, enabledCampaignSuccessEnvelope } from "./enabled-campaign-envelope"

export async function getResearchCampaignStatus(input: Readonly<{
  readonly directory: string
  readonly campaign_id: string
}>, dependencies: CertificationApplicationDependencies = {}): Promise<PublicCampaignApplicationResult> {
  const result = await (dependencies.read_campaign ?? readResearchCampaignState)(input.directory, input.campaign_id)
  if (result.kind === "error") return campaignErrorEnvelope(result)
  if (!certificationEnabled(result.state)) return campaignSuccessEnvelope(result.state)
  if (result.state.phase !== "PROMOTION" || result.state.selected_candidate_id === null) {
    return enabledCampaignSuccessEnvelope(result.state, { kind: "not_started" })
  }
  const certification = await getResearchCertificationStatus(input, {
    ...dependencies,
    read_campaign: async () => ({ kind: "ok", state: result.state }),
  })
  switch (certification.kind) {
    case "ok":
      if (certification.state === null) return enabledCampaignSuccessEnvelope(certification.campaign, { kind: "not_started" })
      if (certification.content_sha256 === null) {
        return enabledCampaignErrorEnvelope({ error_code: "STORAGE_READ_FAILED", message: "Certification content hash is unavailable" })
      }
      return enabledCampaignSuccessEnvelope(certification.campaign, {
        kind: "readable",
        state: certification.state,
        content_sha256: certification.content_sha256,
        effective_status: certification.effective_status,
      })
    case "disabled":
      return campaignSuccessEnvelope(certification.campaign)
    case "error":
      if (certification.error_code === "STORAGE_READ_FAILED") {
        return enabledCampaignAnomalyEnvelope(result.state, {
          ...(certification.reason === undefined ? {} : { reason: certification.reason }),
          message: certification.message,
        })
      }
      return enabledCampaignErrorEnvelope({
        ...certification,
        error_code: certification.error_code === "CAMPAIGN_ABORTED" ? "ABORTED" : certification.error_code,
      })
    default:
      return assertNever(certification)
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected certification status result: ${String(value)}`)
}
