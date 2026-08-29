import type { ResearchCampaignStateV1 } from "../state"
import { abortAfterCompletion, prepareOperationCompletion } from "./operation-jobs"
import { illegal, validated } from "./transition-result"
import type { CampaignTransitionEvent, CampaignTransitionResult } from "./types"

type AbortEvent = Extract<CampaignTransitionEvent, { readonly type: "ABORT" }>
type BlockEvent = Extract<CampaignTransitionEvent, { readonly type: "BLOCK" }>
type RejectEvent = Extract<CampaignTransitionEvent, { readonly type: "REJECT" }>

export function reduceCampaignAbort(
  state: ResearchCampaignStateV1,
  event: AbortEvent,
): CampaignTransitionResult {
  switch (state.status) {
    case "RUNNING":
      return validated(state, {
        ...state,
        state_revision: state.state_revision + 1,
        abort_requested: true,
        abort_reason: event.reason,
      })
    case "READY":
    case "AWAITING_HUMAN":
    case "BLOCKED":
      return validated(state, {
        ...state,
        state_revision: state.state_revision + 1,
        status: "ABORTED",
        awaiting_reason: null,
        abort_requested: true,
        abort_reason: event.reason,
        blocked_reason: null,
        active_job_ids: [],
      })
    case "PROMOTION_READY":
    case "REJECTED":
    case "ABORTED":
      return illegal(state, "Terminal campaigns cannot abort again")
    default:
      return assertNever(state)
  }
}

export function reduceCampaignBlock(
  state: ResearchCampaignStateV1,
  event: BlockEvent,
): CampaignTransitionResult {
  if (state.status !== "RUNNING") return illegal(state, "Only a running operation can become blocked")
  const completion = prepareOperationCompletion(state, event.job_attempts)
  if (!completion.ok) return completion.result
  const aborted = abortAfterCompletion(state, completion)
  if (aborted !== null) return aborted
  return validated(state, {
    ...state,
    state_revision: completion.revision,
    status: "BLOCKED",
    blocked_reason: event.reason,
    active_job_ids: [],
    job_attempts: completion.completed_history,
  })
}

export function reduceCampaignRejection(
  state: ResearchCampaignStateV1,
  event: RejectEvent,
): CampaignTransitionResult {
  if (state.status !== "RUNNING") return illegal(state, "Only a running operation can reject a campaign")
  const completion = prepareOperationCompletion(state, event.job_attempts)
  if (!completion.ok) return completion.result
  const aborted = abortAfterCompletion(state, completion)
  if (aborted !== null) return aborted
  return validated(state, {
    ...state,
    state_revision: completion.revision,
    status: "REJECTED",
    active_job_ids: [],
    job_attempts: completion.completed_history,
  })
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected terminal control state: ${String(value)}`)
}
