import type { CampaignJobAttempt, ResearchCampaignStateV1 } from "../state"
import { sha256 } from "../../workflow/stage-runner/sha256"
import { admitTournamentCandidates } from "../tournament/tournament-admission"
import { consumeApplicableCampaignAmendments } from "./amendment-state"
import { abortAfterCompletion, prepareOperationCompletion } from "./operation-jobs"
import { illegal, invalid, validated } from "./transition-result"
import type { CampaignTransitionEvent, CampaignTransitionResult } from "./types"

type TournamentEvent = Extract<CampaignTransitionEvent, { readonly type: "COMPLETE_TOURNAMENT" }>

export function reduceCompleteTournament(
  state: ResearchCampaignStateV1,
  event: TournamentEvent,
): CampaignTransitionResult {
  if (state.status !== "RUNNING" || state.phase !== "TOURNAMENT") {
    return illegal(state, "Tournament completion requires RUNNING tournament")
  }
  const completion = prepareOperationCompletion(state, event.job_attempts)
  if (!completion.ok) return completion.result
  const aborted = abortAfterCompletion(state, completion)
  if (aborted !== null) return aborted
  if (event.job_attempts.length !== 1 || !matchesTournamentJob(event.job_attempts[0], event)) {
    return invalid(state, "Tournament receipt must match the single active tournament job")
  }
  const admission = admitTournamentCandidates(state)
  if (!admission.ok) return invalid(state, admission.message)
  const admittedIds = admission.candidates.map(({ candidate }) => candidate.candidate_id)
  const admittedScreenIds = admission.candidates.flatMap(({ screens }) => screens.map((screen) => screen.screen_id))
  if (!sameOrder(event.tournament_receipt.screen_ids, admittedScreenIds)) {
    return invalid(state, "Tournament receipt must bind the complete fixed survivor screen set")
  }
  const common = {
    ...state,
    state_revision: completion.revision,
    active_job_ids: [],
    job_attempts: completion.committed_history,
    tournament_receipts: [...state.tournament_receipts, event.tournament_receipt],
    amendments: consumeApplicableCampaignAmendments(state, "TOURNAMENT", completion.revision),
  }
  switch (event.tournament_receipt.result.kind) {
    case "NEEDS_HUMAN":
      if (event.merge_candidate !== null) return invalid(state, "NEEDS_HUMAN cannot create a merge candidate")
      return validated(state, {
        ...common,
        status: "AWAITING_HUMAN",
        awaiting_reason: "TOURNAMENT_NEEDS_HUMAN",
      })
    case "DECIDED": {
      if (!sameOrder(event.tournament_receipt.result.actions.map((action) => action.candidate_id), admittedIds)) {
        return invalid(state, "Tournament actions must cover the fixed survivor set in stable order")
      }
      const kept = event.tournament_receipt.result.actions.find((action) => action.action === "KEEP")
      if (kept !== undefined) {
        if (event.merge_candidate !== null) return invalid(state, "KEEP cannot create a merge candidate")
        return validated(state, {
          ...common,
          phase: "DEEP_REFINEMENT",
          status: "READY",
          selected_candidate_id: kept.candidate_id,
        })
      }
      if (event.merge_candidate?.candidate_kind !== "MERGE_IDEA") {
        return invalid(state, "MERGE_IDEA requires one fresh merge candidate")
      }
      const mergeError = validateMergeCandidate(state, event.merge_candidate, event.tournament_receipt.result, completion.revision)
      if (mergeError !== null) return invalid(state, mergeError)
      return validated(state, {
        ...common,
        phase: "DEEP_REFINEMENT",
        status: "READY",
        candidates: [...state.candidates, event.merge_candidate],
        selected_candidate_id: event.merge_candidate.candidate_id,
      })
    }
    default:
      return assertNever(event.tournament_receipt.result)
  }
}

function matchesTournamentJob(
  job: CampaignJobAttempt | undefined,
  event: TournamentEvent,
): boolean {
  return job?.phase === "COMPLETED"
    && job.target.kind === "TOURNAMENT"
    && job.receipt.kind === "TOURNAMENT"
    && job.receipt.result !== undefined
    && job.job_id === event.tournament_receipt.job_id
    && job.target.tournament_id === event.tournament_receipt.tournament_id
    && JSON.stringify(job.receipt.result) === JSON.stringify(event.tournament_receipt.result)
}

function validateMergeCandidate(
  state: ResearchCampaignStateV1,
  candidate: Extract<ResearchCampaignStateV1["candidates"][number], { readonly candidate_kind: "MERGE_IDEA" }>,
  result: Extract<ResearchCampaignStateV1["tournament_receipts"][number]["result"], { readonly kind: "DECIDED" }>,
  revision: number,
): string | null {
  const parents = result.actions.filter((action) => action.action === "MERGE_IDEA").map((action) => action.candidate_id)
  if (state.candidates.some((existing) => existing.candidate_id === candidate.candidate_id)
    || candidate.created_at_revision !== revision || candidate.artifact !== null
    || candidate.child_run_id !== `${state.campaign_id}::${candidate.candidate_id}`
    || candidate.attachments.length !== 0 || parents.includes(candidate.candidate_id)
    || !sameOrder(candidate.parent_candidate_ids, parents)) {
    return "MERGE_IDEA requires one fresh acyclic lineage-only candidate"
  }
  if (result.synthesis_brief === null || result.synthesis_brief_sha256 === null
    || candidate.synthesis_brief !== result.synthesis_brief
    || candidate.synthesis_brief_sha256 !== result.synthesis_brief_sha256
    || sha256(candidate.synthesis_brief) !== candidate.synthesis_brief_sha256) {
    return "Merge candidate must preserve the exact immutable synthesis brief hash"
  }
  return null
}

function sameOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected tournament outcome: ${String(value)}`)
}
