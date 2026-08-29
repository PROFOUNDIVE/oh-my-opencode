import type { ResearchCampaignStateV1 } from "../state"
import { renderApplicableCampaignAmendments } from "./amendment-state"
import type { CampaignNextAction } from "./types"

const READY_ACTIONS = ["step_one_stage", "step_to_checkpoint", "amend", "abort"] as const
const RECONCILE_ACTIONS = ["step_one_stage", "abort"] as const
const INTERVENTION_ACTIONS = ["amend", "abort"] as const
const PROMOTION_ACTIONS = ["promote", "abort"] as const

export function getCampaignNextActions(state: ResearchCampaignStateV1): readonly CampaignNextAction[] {
  switch (state.status) {
    case "READY":
      return buildActions(state, READY_ACTIONS, "READY_TO_RUN")
    case "RUNNING":
      return buildActions(state, RECONCILE_ACTIONS, "RECONCILIATION_REQUIRED")
    case "BLOCKED":
      return buildActions(state, RECONCILE_ACTIONS, "RECONCILIATION_BLOCKED")
    case "AWAITING_HUMAN":
      return actionsAtCheckpoint(state)
    case "PROMOTION_READY":
    case "REJECTED":
    case "ABORTED":
      return []
    default:
      return assertNever(state)
  }
}

function actionsAtCheckpoint(
  state: Extract<ResearchCampaignStateV1, { readonly status: "AWAITING_HUMAN" }>,
): readonly CampaignNextAction[] {
  switch (state.awaiting_reason) {
    case "AFTER_INITIAL_SCREEN":
      return buildActions(state, READY_ACTIONS, "HUMAN_CHECKPOINT")
    case "TOURNAMENT_NEEDS_HUMAN":
      return amendmentGatedActions(
        state,
        renderApplicableCampaignAmendments(state, "TOURNAMENT").length > 0,
      )
    case "CHILD_WORKFLOW_INTERVENTION":
      return amendmentGatedActions(
        state,
        renderApplicableCampaignAmendments(state, "DEEP_REFINEMENT").length > 0,
      )
    case "BEFORE_PROMOTION":
      return buildActions(state, PROMOTION_ACTIONS, "PROMOTION_DECISION_REQUIRED")
    default:
      return assertNever(state.awaiting_reason)
  }
}

function amendmentGatedActions(
  state: ResearchCampaignStateV1,
  satisfied: boolean,
): readonly CampaignNextAction[] {
  return buildActions(
    state,
    satisfied ? READY_ACTIONS : INTERVENTION_ACTIONS,
    satisfied ? "HUMAN_CHECKPOINT" : "AMENDMENT_REQUIRED",
  )
}

function buildActions(
  state: ResearchCampaignStateV1,
  actions: readonly CampaignNextAction["action"][],
  reason: CampaignNextAction["reason"],
): readonly CampaignNextAction[] {
  return actions.map((action) => ({ action, required_state_revision: state.state_revision, reason }))
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected campaign next-action state: ${String(value)}`)
}
