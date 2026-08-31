import { abortResearchCertification } from "../certification/application/abort-research-certification"
import type { CertificationApplicationDependencies } from "../certification/application/certification-application-dependencies"
import { hashResearchCertificationState } from "../certification/state/schema"
import { readResearchCampaignState } from "../storage"
import type { CampaignApplicationResult, PublicCampaignApplicationResult } from "./campaign-application-result"
import { certificationEnabled } from "./campaign-lifecycle-envelope"
import type { CampaignMutationDependencies } from "./campaign-mutation-dependencies"
import { commitCampaignTransition } from "./commit-campaign-transition"
import { enabledCampaignErrorEnvelope } from "./enabled-campaign-error-envelope"
import { enabledCampaignSuccessEnvelope } from "./enabled-campaign-envelope"
import { stateResultEnvelope } from "./state-result-envelope"

type AbortResearchCampaignInput = Readonly<{
  readonly directory: string
  readonly campaign_id: string
  readonly expected_state_revision: number
  readonly expected_certification_revision?: number | null
  readonly reason?: string
}>

type AbortResearchCampaignDependencies = CampaignMutationDependencies & CertificationApplicationDependencies

export async function abortResearchCampaign(
  input: AbortResearchCampaignInput,
  dependencies: AbortResearchCampaignDependencies = {},
): Promise<PublicCampaignApplicationResult> {
  const current = await (dependencies.read_state ?? dependencies.read_campaign ?? readResearchCampaignState)(
    input.directory,
    input.campaign_id,
  )
  if (current.kind === "error") return stateResultEnvelope(current)
  if (!certificationEnabled(current.state)) {
    return input.expected_certification_revision === undefined
      ? abortPhaseA(input, dependencies)
      : stateResultEnvelope({ kind: "error", error_code: "VALIDATION_ERROR", message: "Certification revision is not accepted for a Phase A campaign" })
  }
  if (input.expected_certification_revision === undefined) {
    return enabledCampaignErrorEnvelope({ error_code: "VALIDATION_ERROR", message: "Expected certification revision is required" })
  }
  if (current.state.phase !== "PROMOTION" || current.state.selected_candidate_id === null) {
    if (input.expected_certification_revision !== null) {
      return enabledCampaignErrorEnvelope({ error_code: "STALE_CERTIFICATION_REVISION", message: "Uninitialized certification requires a null expected revision" })
    }
    const aborted = await commitCampaignTransition({
      directory: input.directory,
      campaign_id: input.campaign_id,
      expected_state_revision: input.expected_state_revision,
      event: { type: "ABORT", reason: input.reason ?? null },
    }, { ...dependencies, read_state: async () => current })
    return aborted.kind === "ok"
      ? enabledCampaignSuccessEnvelope(aborted.state, { kind: "not_started" })
      : enabledCampaignErrorEnvelope(aborted)
  }
  const result = await abortResearchCertification({
    ...input,
    expected_certification_revision: input.expected_certification_revision,
  }, {
    ...dependencies,
    read_campaign: async () => current,
  })
  if (result.kind === "error") {
    if (result.error_code === "SIDECAR_CLEANUP_FAILED" && result.campaign !== undefined) {
      return enabledCampaignErrorEnvelope({
        error_code: result.error_code,
        message: result.message,
        current_state_revision: result.campaign.state_revision,
        campaign_aborted: true,
      })
    }
    return enabledCampaignErrorEnvelope({
      ...result,
      error_code: result.error_code === "CAMPAIGN_ABORTED" ? "ABORTED" : result.error_code,
    })
  }
  return result.certification === null
    ? enabledCampaignSuccessEnvelope(result.campaign, { kind: "not_started" })
    : enabledCampaignSuccessEnvelope(result.campaign, {
        kind: "readable",
        state: result.certification,
        content_sha256: hashResearchCertificationState(result.certification),
        effective_status: "ABORTED",
      })
}

async function abortPhaseA(
  input: AbortResearchCampaignInput,
  dependencies: CampaignMutationDependencies,
): Promise<CampaignApplicationResult> {
  return stateResultEnvelope(await commitCampaignTransition({
    directory: input.directory,
    campaign_id: input.campaign_id,
    expected_state_revision: input.expected_state_revision,
    event: { type: "ABORT", reason: input.reason ?? null },
  }, dependencies))
}
