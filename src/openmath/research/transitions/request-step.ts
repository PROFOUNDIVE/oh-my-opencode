import type { ResearchCampaignStateV1 } from "../state"
import { renderApplicableCampaignAmendments } from "./amendment-state"
import { accepted, illegal } from "./transition-result"
import type { CampaignTransitionEvent, CampaignTransitionResult } from "./types"

type RequestStepEvent = Extract<CampaignTransitionEvent, { readonly type: "REQUEST_STEP" }>

export function reduceRequestCampaignStep(
  state: ResearchCampaignStateV1,
  event: RequestStepEvent,
): CampaignTransitionResult {
  switch (state.status) {
    case "READY":
      return accepted(state, "execute")
    case "RUNNING":
    case "BLOCKED":
      return event.mode === "one_stage"
        ? accepted(state, "reconcile")
        : illegal(state, "Only one-stage reconciliation is legal while work is unresolved")
    case "AWAITING_HUMAN":
      return requestFromCheckpoint(state)
    case "PROMOTION_READY":
    case "REJECTED":
    case "ABORTED":
      return illegal(state, "Terminal campaigns cannot step")
    default:
      return assertNever(state)
  }
}

function requestFromCheckpoint(
  state: Extract<ResearchCampaignStateV1, { readonly status: "AWAITING_HUMAN" }>,
): CampaignTransitionResult {
  switch (state.awaiting_reason) {
    case "AFTER_INITIAL_SCREEN":
      return accepted(state, "execute")
    case "TOURNAMENT_NEEDS_HUMAN":
      return renderApplicableCampaignAmendments(state, "TOURNAMENT").length > 0
        ? accepted(state, "execute")
        : illegal(state, "Tournament retry requires an applicable amendment")
    case "CHILD_WORKFLOW_INTERVENTION":
      return renderApplicableCampaignAmendments(state, "DEEP_REFINEMENT").length > 0
        ? accepted(state, "execute")
        : illegal(state, "Child workflow retry requires an applicable amendment")
    case "BEFORE_PROMOTION":
      return illegal(state, "Promotion requires an explicit decision")
    default:
      return assertNever(state.awaiting_reason)
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected campaign step state: ${String(value)}`)
}
