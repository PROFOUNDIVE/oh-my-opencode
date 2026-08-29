import type { ResearchCampaignStateV1 } from "../state"
import { parseFrozenCandidateSources } from "../candidates/frozen-candidate-sources"
import { validateCompleteScreeningMatrix } from "../screening/screening-barrier"
import { consumeApplicableCampaignAmendments } from "./amendment-state"
import { abortAfterCompletion, prepareOperationCompletion } from "./operation-jobs"
import { illegal, invalid, validated } from "./transition-result"
import type { CampaignTransitionEvent, CampaignTransitionResult } from "./types"

type ScreeningEvent = Extract<CampaignTransitionEvent, { readonly type: "COMPLETE_SCREENING" }>

export function reduceCompleteScreening(
  state: ResearchCampaignStateV1,
  event: ScreeningEvent,
): CampaignTransitionResult {
  if (state.status !== "RUNNING" || state.phase !== "SCREENING") {
    return illegal(state, "Screening completion requires RUNNING screening")
  }
  const completion = prepareOperationCompletion(state, event.job_attempts)
  if (!completion.ok) return completion.result
  const aborted = abortAfterCompletion(state, completion)
  if (aborted !== null) return aborted
  const candidates = state.candidates.filter((candidate) => candidate.artifact !== null)
  const frozen = parseFrozenCandidateSources(state)
  if (!frozen.ok) return invalid(state, frozen.message)
  const roleIds = frozen.sources.profile.screening_roles.map((role) => role.id)
  const barrierError = validateCompleteScreeningMatrix({
    candidates,
    role_ids: roleIds,
    jobs: event.job_attempts,
    receipts: event.screen_receipts,
  })
  if (barrierError !== null) return invalid(state, barrierError)
  const allReceipts = [...state.screen_receipts, ...event.screen_receipts]
  return validated(state, {
    ...state,
    state_revision: completion.revision,
    status: "AWAITING_HUMAN",
    awaiting_reason: "AFTER_INITIAL_SCREEN",
    active_job_ids: [],
    job_attempts: completion.committed_history,
    screen_receipts: allReceipts,
    amendments: consumeApplicableCampaignAmendments(state, "SCREENING", completion.revision),
  })
}
