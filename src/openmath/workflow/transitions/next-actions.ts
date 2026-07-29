import type { WorkflowStateV1 } from "../state"
import type { NextAction } from "./types"

const ALL_ACTIONS = [
  "step_one_stage",
  "step_to_checkpoint",
  "amend",
  "reload_prompts",
  "reload_references",
  "abort",
] as const
const INTERVENTION_ACTIONS = ["amend", "reload_prompts", "reload_references", "abort"] as const
const BLOCKED_ACTIONS = ["step_one_stage", "abort"] as const

export function getNextActions(state: WorkflowStateV1): readonly NextAction[] {
  switch (state.status) {
    case "READY":
      return buildActions(state, ALL_ACTIONS, "READY_TO_RUN")
    case "RUNNING":
    case "PASSED":
    case "EXHAUSTED":
    case "ABORTED":
      return []
    case "BLOCKED":
      return buildActions(state, BLOCKED_ACTIONS, "RECONCILIATION_BLOCKED")
    case "AWAITING_HUMAN": {
      const reason = state.awaiting_reason
      switch (reason) {
        case "CHECKPOINT":
          return buildActions(state, ALL_ACTIONS, "CHECKPOINT_PAUSED")
        case "INCONCLUSIVE":
        case "PARSE_FAILURE":
          return buildActions(
            state,
            state.intervention_satisfied ? ALL_ACTIONS : INTERVENTION_ACTIONS,
            "INPUT_CHANGE_REQUIRED",
          )
        default:
          return assertNever(reason)
      }
    }
    default:
      return assertNever(state)
  }
}

function buildActions(
  state: WorkflowStateV1,
  actions: readonly NextAction["action"][],
  reason: NextAction["reason"],
): readonly NextAction[] {
  return actions.map((action) => ({ action, required_state_revision: state.state_revision, reason }))
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected transition value: ${String(value)}`)
}
