import type { StorageRuntime } from "../../../workflow/storage/storage-runtime-contract"
import { readResearchCampaignState } from "../../storage"
import type { ResearchCampaignStateV1 } from "../../state"

export type CertificationCampaignGuard = Readonly<{
  readonly expected_state_revision: number
  readonly expected_status: ResearchCampaignStateV1["status"]
}>

export type CertificationCampaignGuardResult =
  | Readonly<{ readonly kind: "ok" }>
  | Readonly<{
      readonly kind: "error"
      readonly error_code: "CAMPAIGN_ABORTED" | "STALE_STATE_REVISION" | "STORAGE_READ_FAILED"
      readonly message: string
      readonly current_state_revision?: number
    }>

export async function validateCertificationCampaignGuard(
  directory: string,
  campaignId: string,
  guard: CertificationCampaignGuard,
  runtime: StorageRuntime,
): Promise<CertificationCampaignGuardResult> {
  const campaign = await readResearchCampaignState(directory, campaignId, runtime)
  if (campaign.kind === "error") return { kind: "error", error_code: "STORAGE_READ_FAILED", message: campaign.message }
  if (campaign.state.state_revision !== guard.expected_state_revision) {
    return {
      kind: "error",
      error_code: "STALE_STATE_REVISION",
      current_state_revision: campaign.state.state_revision,
      message: `Expected research campaign revision ${guard.expected_state_revision}, found ${campaign.state.state_revision}`,
    }
  }
  if (campaign.state.status !== guard.expected_status) {
    return {
      kind: "error",
      error_code: campaign.state.status === "ABORTED" ? "CAMPAIGN_ABORTED" : "STALE_STATE_REVISION",
      message: `Certification sidecar mutation requires campaign status ${guard.expected_status}`,
    }
  }
  return { kind: "ok" }
}
