import { readResearchCampaignState } from "../storage"
import { reduceCampaignTransition, shouldContinueCampaignStep, type CampaignStepMode } from "../transitions"
import { campaignErrorEnvelope } from "./campaign-envelope"
import type { CampaignApplicationResult } from "./campaign-application-result"
import type { CampaignStepDependencies } from "./campaign-scheduler-contract"
import type { PromotionDossierStepDependencies } from "../dossier/promotion-dossier-step"
import { staleCampaignRevision } from "./commit-campaign-transition"
import { runCampaignOperation } from "./run-campaign-operation"
import { stateResultEnvelope } from "./state-result-envelope"

export async function stepResearchCampaign(input: Readonly<{
  readonly directory: string
  readonly campaign_id: string
  readonly expected_state_revision: number
  readonly mode: CampaignStepMode
}>, dependencies: CampaignStepDependencies | PromotionDossierStepDependencies): Promise<CampaignApplicationResult> {
  const readState = "read_state" in dependencies
    ? dependencies.read_state ?? readResearchCampaignState
    : readResearchCampaignState
  const current = await readState(input.directory, input.campaign_id)
  if (current.kind === "error") return campaignErrorEnvelope(current)
  if (current.state.state_revision !== input.expected_state_revision) {
    return stateResultEnvelope(staleCampaignRevision(input.expected_state_revision, current.state.state_revision))
  }
  const preflight = reduceCampaignTransition(current.state, { type: "REQUEST_STEP", mode: input.mode })
  if (!preflight.ok) return campaignErrorEnvelope({ error_code: preflight.error_code, message: preflight.message })

  let state = current.state
  do {
    if (state.phase === "PROMOTION" && state.status === "READY") {
      if (!("prepare_dossier" in dependencies)) {
        return campaignErrorEnvelope({ error_code: "VALIDATION_ERROR", message: "Promotion dossier dependencies are unavailable" })
      }
      const prepared = await dependencies.prepare_dossier({
        directory: input.directory,
        campaign_id: input.campaign_id,
        expected_state_revision: state.state_revision,
      })
      if (prepared.kind === "error") return stateResultEnvelope(prepared)
      state = prepared.state
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
    if (result.kind === "error") return stateResultEnvelope(result)
    state = result.state
  } while (shouldContinueCampaignStep(input.mode, state))
  return stateResultEnvelope({ kind: "ok", state })
}
