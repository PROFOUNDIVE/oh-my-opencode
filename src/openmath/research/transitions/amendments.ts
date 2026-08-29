import type { ResearchCampaignStateV1 } from "../state"
import { activeCampaignAmendments } from "./amendment-state"
import { illegal, invalid, validated } from "./transition-result"
import type { CampaignTransitionEvent, CampaignTransitionResult } from "./types"

type AddEvent = Extract<CampaignTransitionEvent, { readonly type: "ADD_AMENDMENT" }>
type RetractEvent = Extract<CampaignTransitionEvent, { readonly type: "RETRACT_AMENDMENT" }>

export function reduceAddCampaignAmendment(
  state: ResearchCampaignStateV1,
  event: AddEvent,
): CampaignTransitionResult {
  if (!amendmentStatusAllowsMutation(state)) return illegal(state, "Campaign status cannot accept amendments")
  const revision = state.state_revision + 1
  return validated(state, {
    ...state,
    state_revision: revision,
    amendments: [
      ...state.amendments,
      {
        event_type: "ADDED",
        amendment_id: `amendment-${revision}`,
        kind: event.kind,
        scope: event.scope,
        content: event.content,
        lifecycle: "ACTIVE",
        state_revision: revision,
      },
    ],
  })
}

export function reduceRetractCampaignAmendment(
  state: ResearchCampaignStateV1,
  event: RetractEvent,
): CampaignTransitionResult {
  if (!amendmentStatusAllowsMutation(state)) return illegal(state, "Campaign status cannot retract amendments")
  if (!activeCampaignAmendments(state).some((amendment) => amendment.amendment_id === event.amendment_id)) {
    return invalid(state, "Amendment is stale, consumed, retracted, or unknown")
  }
  const revision = state.state_revision + 1
  return validated(state, {
    ...state,
    state_revision: revision,
    amendments: [
      ...state.amendments,
      {
        event_type: "RETRACTED",
        amendment_id: event.amendment_id,
        lifecycle: "RETRACTED",
        state_revision: revision,
      },
    ],
  })
}

function amendmentStatusAllowsMutation(state: ResearchCampaignStateV1): boolean {
  switch (state.status) {
    case "READY":
      return true
    case "AWAITING_HUMAN":
      return state.awaiting_reason !== "BEFORE_PROMOTION"
    case "RUNNING":
    case "BLOCKED":
    case "PROMOTION_READY":
    case "REJECTED":
    case "ABORTED":
      return false
    default:
      return assertNever(state)
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected amendment state: ${String(value)}`)
}
