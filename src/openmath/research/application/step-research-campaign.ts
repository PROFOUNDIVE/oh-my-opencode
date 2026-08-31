import { readResearchCampaignState } from "../storage"
import { hashResearchCertificationState } from "../certification/state/schema"
import { reduceCampaignTransition, shouldContinueCampaignStep, type CampaignStepMode } from "../transitions"
import { campaignErrorEnvelope } from "./campaign-envelope"
import type { PublicCampaignApplicationResult } from "./campaign-application-result"
import type { CampaignStepDependencies } from "./campaign-scheduler-contract"
import { staleCampaignRevision } from "./commit-campaign-transition"
import { runCampaignOperation } from "./run-campaign-operation"
import { stateResultEnvelope } from "./state-result-envelope"
import { routePromotionStep, type PromotionStepDependencies } from "./promotion-step-router"
import { campaignLifecycleEnvelope, certificationEnabled } from "./campaign-lifecycle-envelope"
import { enabledCampaignErrorEnvelope } from "./enabled-campaign-error-envelope"
import { enabledCampaignSuccessEnvelope } from "./enabled-campaign-envelope"

export async function stepResearchCampaign(input: Readonly<{
  readonly directory: string
  readonly campaign_id: string
  readonly expected_state_revision: number
  readonly expected_certification_revision?: number | null
  readonly mode: CampaignStepMode
}>, dependencies: CampaignStepDependencies | PromotionStepDependencies): Promise<PublicCampaignApplicationResult> {
  const readState = "read_state" in dependencies
    ? dependencies.read_state ?? readResearchCampaignState
    : readResearchCampaignState
  const current = await readState(input.directory, input.campaign_id)
  if (current.kind === "error") return campaignErrorEnvelope(current)
  const enabled = certificationEnabled(current.state)
  if (current.state.state_revision !== input.expected_state_revision) {
    const stale = staleCampaignRevision(input.expected_state_revision, current.state.state_revision)
    if (!enabled) return stateResultEnvelope(stale)
    return enabledCampaignErrorEnvelope({
      error_code: "STALE_STATE_REVISION",
      message: `Expected revision ${input.expected_state_revision}, found ${current.state.state_revision}`,
      current_state_revision: current.state.state_revision,
    })
  }
  if (enabled && input.expected_certification_revision === undefined) {
    return enabledCampaignErrorEnvelope({ error_code: "VALIDATION_ERROR", message: "Expected certification revision is required" })
  }
  if (!enabled && input.expected_certification_revision !== undefined) {
    return campaignErrorEnvelope({ error_code: "VALIDATION_ERROR", message: "Certification revision is not accepted for a Phase A campaign" })
  }
  const preflight = reduceCampaignTransition(current.state, { type: "REQUEST_STEP", mode: input.mode })
  if (!preflight.ok) {
    const error = { error_code: preflight.error_code, message: preflight.message }
    return enabled ? enabledCampaignErrorEnvelope(error) : campaignErrorEnvelope(error)
  }

  let state = current.state
  do {
    if (state.phase === "PROMOTION" && state.status === "READY") {
      const promotionDependencies: PromotionStepDependencies = {
        ...("prepare_dossier" in dependencies ? { prepare_dossier: dependencies.prepare_dossier } : {}),
        ...("step_certification" in dependencies ? { step_certification: dependencies.step_certification } : {}),
      }
      const routed = await routePromotionStep({
        directory: input.directory,
        campaign: state,
        expected_certification_revision: input.expected_certification_revision,
        mode: input.mode,
        read_campaign: async () => {
          return readState(input.directory, input.campaign_id)
        },
      }, promotionDependencies)
      if (routed.result.kind === "error") {
        if (!enabled) return stateResultEnvelope(routed.result)
        const certificationError = routed.certification_result?.kind === "error" ? routed.certification_result : null
        return certificationError === null
          ? enabledCampaignErrorEnvelope(routed.result)
          : enabledCampaignErrorEnvelope({
              ...certificationError,
              error_code: certificationError.error_code === "CAMPAIGN_ABORTED" ? "ABORTED" : certificationError.error_code,
            })
      }
      state = routed.result.state
      if (routed.certification_next_actions !== null) {
        const certification = routed.certification_result
        if (certification === null || certification.kind === "error") {
          return enabledCampaignErrorEnvelope({ error_code: "STORAGE_READ_FAILED", message: "Certification state is unavailable" })
        }
        const effectiveStatus = state.status === "AWAITING_HUMAN" && state.awaiting_reason === "BEFORE_PROMOTION"
          ? "BEFORE_PROMOTION"
          : certification.state.status
        return enabledCampaignSuccessEnvelope(state, {
          kind: "readable",
          state: certification.state,
          content_sha256: hashResearchCertificationState(certification.state),
          effective_status: effectiveStatus,
        })
      }
      if (enabled && routed.certification_result?.kind === "ok") {
        return enabledCampaignSuccessEnvelope(state, {
          kind: "readable",
          state: routed.certification_result.state,
          content_sha256: hashResearchCertificationState(routed.certification_result.state),
          effective_status: state.status === "AWAITING_HUMAN" && state.awaiting_reason === "BEFORE_PROMOTION"
            ? "BEFORE_PROMOTION"
            : routed.certification_result.state.status,
        })
      }
      continue
    }
    if (!("plan_operation" in dependencies)) {
      return campaignErrorEnvelope({ error_code: "VALIDATION_ERROR", message: "Campaign operation dependencies are unavailable" })
    }
    const result = await runCampaignOperation({
      directory: input.directory,
      campaign_id: input.campaign_id,
      state_revision: state.state_revision,
      operation_revision: state.status === "RUNNING" ? state.state_revision : state.state_revision + 1,
    }, dependencies)
    if (result.kind === "error") return enabled ? enabledCampaignErrorEnvelope(result) : stateResultEnvelope(result)
    state = result.state
  } while (shouldContinueCampaignStep(input.mode, state))
  return enabled ? campaignLifecycleEnvelope(state) : stateResultEnvelope({ kind: "ok", state })
}
