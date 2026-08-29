import type { ResearchCampaignStateV1 } from "../state"
import { reduceAdmitCampaignOperation } from "./admit-operation"
import { reduceAddCampaignAmendment, reduceRetractCampaignAmendment } from "./amendments"
import { reduceCompleteChildWorkflow } from "./complete-child-workflow"
import { reduceCompleteDiscovery } from "./complete-discovery"
import { reduceCompleteScreening } from "./complete-screening"
import { reduceCompleteTournament } from "./complete-tournament"
import { reduceDossierReady, reducePromotionDecision } from "./promotion"
import { reduceRequestCampaignStep } from "./request-step"
import { reduceCampaignAbort, reduceCampaignBlock, reduceCampaignRejection } from "./terminal-controls"
import { illegal } from "./transition-result"
import type { CampaignTransitionEvent, CampaignTransitionResult } from "./types"

export function reduceCampaignTransition(
  state: ResearchCampaignStateV1,
  event: CampaignTransitionEvent,
): CampaignTransitionResult {
  if (state.status === "PROMOTION_READY" || state.status === "REJECTED" || state.status === "ABORTED") {
    return illegal(state, "Terminal campaigns are immutable")
  }
  switch (event.type) {
    case "REQUEST_STEP":
      return reduceRequestCampaignStep(state, event)
    case "ADMIT_OPERATION":
      return reduceAdmitCampaignOperation(state, event)
    case "COMPLETE_DISCOVERY":
      return reduceCompleteDiscovery(state, event)
    case "COMPLETE_SCREENING":
      return reduceCompleteScreening(state, event)
    case "COMPLETE_TOURNAMENT":
      return reduceCompleteTournament(state, event)
    case "COMPLETE_CHILD_WORKFLOW":
      return reduceCompleteChildWorkflow(state, event)
    case "DOSSIER_READY":
      return reduceDossierReady(state, event)
    case "ADD_AMENDMENT":
      return reduceAddCampaignAmendment(state, event)
    case "RETRACT_AMENDMENT":
      return reduceRetractCampaignAmendment(state, event)
    case "PROMOTE":
      return reducePromotionDecision(state, event)
    case "ABORT":
      return reduceCampaignAbort(state, event)
    case "BLOCK":
      return reduceCampaignBlock(state, event)
    case "REJECT":
      return reduceCampaignRejection(state, event)
    default:
      return assertNever(event)
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected campaign transition event: ${String(value)}`)
}
