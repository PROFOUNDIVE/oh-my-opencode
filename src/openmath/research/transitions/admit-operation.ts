import type { CampaignJobAttempt, CampaignPhase, ResearchCampaignStateV1 } from "../state"
import { parseFrozenCandidateSources } from "../candidates/frozen-candidate-sources"
import { aggregateScreening } from "../screening/screening-aggregation"
import { validateCompleteScreeningMatrix } from "../screening/screening-barrier"
import { renderApplicableCampaignAmendments } from "./amendment-state"
import { illegal, invalid, validated } from "./transition-result"
import type { CampaignTransitionEvent, CampaignTransitionResult } from "./types"

type AdmissionEvent = Extract<CampaignTransitionEvent, { readonly type: "ADMIT_OPERATION" }>

export function reduceAdmitCampaignOperation(
  state: ResearchCampaignStateV1,
  event: AdmissionEvent,
): CampaignTransitionResult {
  const admittedPhase = phaseForAdmission(state)
  if (admittedPhase === null) return illegal(state, "Campaign status cannot admit an operation")
  if (event.job_attempts.length === 0) return invalid(state, "Operation admission requires prepared jobs")
  if (state.phase !== "DISCOVERY" && event.candidates.length > 0) {
    return invalid(state, "Only discovery admission may add planned candidates")
  }
  if (!admissionGateSatisfied(state, admittedPhase)) {
    return invalid(state, "Campaign checkpoint prerequisites are not satisfied")
  }
  const revision = state.state_revision + 1
  const candidateIds = new Set([...state.candidates, ...event.candidates].map((candidate) => candidate.candidate_id))
  const jobIds = new Set<string>()
  for (const job of event.job_attempts) {
    if (job.phase !== "PREPARED" || job.prepared_at_revision !== revision || job.phase_revision !== revision) {
      return invalid(state, "Admitted jobs must be PREPARED at the next campaign revision")
    }
    if (jobIds.has(job.job_id) || !targetMatchesPhase(job, admittedPhase) || !targetCandidateExists(job, candidateIds)) {
      return invalid(state, "Prepared job target is invalid for the admitted operation")
    }
    jobIds.add(job.job_id)
  }
  return validated(state, {
    ...state,
    state_revision: revision,
    phase: admittedPhase,
    status: "RUNNING",
    awaiting_reason: null,
    blocked_reason: null,
    active_job_ids: event.job_attempts.map((job) => job.job_id),
    candidates: [...state.candidates, ...event.candidates],
    job_attempts: [...state.job_attempts, ...event.job_attempts],
  })
}

function phaseForAdmission(state: ResearchCampaignStateV1): CampaignPhase | null {
  switch (state.status) {
    case "READY":
      return state.phase === "PROMOTION" ? null : state.phase
    case "AWAITING_HUMAN":
      switch (state.awaiting_reason) {
        case "AFTER_INITIAL_SCREEN":
          return "TOURNAMENT"
        case "TOURNAMENT_NEEDS_HUMAN":
          return renderApplicableCampaignAmendments(state, "TOURNAMENT").length > 0 ? "TOURNAMENT" : null
        case "CHILD_WORKFLOW_INTERVENTION":
          return renderApplicableCampaignAmendments(state, "DEEP_REFINEMENT").length > 0 ? "DEEP_REFINEMENT" : null
        case "BEFORE_PROMOTION":
          return null
        default:
          return assertNever(state)
      }
    case "RUNNING":
    case "BLOCKED":
    case "PROMOTION_READY":
    case "REJECTED":
    case "ABORTED":
      return null
    default:
      return assertNever(state)
  }
}

function admissionGateSatisfied(state: ResearchCampaignStateV1, phase: CampaignPhase): boolean {
  if (phase !== "TOURNAMENT") return true
  const frozen = parseFrozenCandidateSources(state)
  if (!frozen.ok) return false
  const candidates = state.candidates.filter((candidate) => candidate.artifact !== null)
  const screenJobs = state.job_attempts.filter((job) => job.target.kind === "SCREEN")
  const barrierError = validateCompleteScreeningMatrix({
    candidates,
    role_ids: frozen.sources.profile.screening_roles.map((role) => role.id),
    jobs: screenJobs,
    receipts: state.screen_receipts,
  })
  if (barrierError !== null) return false
  const result = aggregateScreening(candidates, state.screen_receipts, frozen.sources.profile.survivor_limit)
  return result.survivor_ids.length > 0
}

function targetMatchesPhase(job: CampaignJobAttempt, phase: CampaignPhase): boolean {
  switch (phase) {
    case "DISCOVERY":
    case "DEEP_REFINEMENT":
      return job.target.kind === "CANDIDATE"
    case "SCREENING":
      return job.target.kind === "SCREEN"
    case "TOURNAMENT":
      return job.target.kind === "TOURNAMENT"
    case "PROMOTION":
      return false
    default:
      return assertNever(phase)
  }
}

function targetCandidateExists(job: CampaignJobAttempt, candidates: ReadonlySet<string>): boolean {
  switch (job.target.kind) {
    case "CANDIDATE":
    case "SCREEN":
      return candidates.has(job.target.candidate_id)
    case "TOURNAMENT":
      return true
    default:
      return assertNever(job.target)
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected campaign admission variant: ${String(value)}`)
}
