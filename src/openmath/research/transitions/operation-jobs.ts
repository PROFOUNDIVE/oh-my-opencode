import type { CampaignJobAttempt, ResearchCampaignStateV1 } from "../state"
import { invalid, validated } from "./transition-result"
import type { CampaignTransitionResult } from "./types"

type CompletedJob = Extract<CampaignJobAttempt, { readonly phase: "COMPLETED" }>

export type PreparedCompletion =
  | {
      readonly ok: true
      readonly revision: number
      readonly completed_history: readonly CampaignJobAttempt[]
      readonly committed_history: readonly CampaignJobAttempt[]
    }
  | { readonly ok: false; readonly result: CampaignTransitionResult }

export function prepareOperationCompletion(
  state: Extract<ResearchCampaignStateV1, { readonly status: "RUNNING" }>,
  attempts: readonly CampaignJobAttempt[],
): PreparedCompletion {
  if (attempts.length !== state.active_job_ids.length || new Set(attempts.map((job) => job.job_id)).size !== attempts.length) {
    return { ok: false, result: invalid(state, "Completed jobs must exactly match active jobs") }
  }
  const revision = state.state_revision + 1
  const existing = new Map(state.job_attempts.map((job) => [job.job_id, job]))
  const completed = new Map<string, CompletedJob>()
  for (const job of attempts) {
    if (job.phase !== "COMPLETED" || job.phase_revision !== revision || !state.active_job_ids.includes(job.job_id)) {
      return { ok: false, result: invalid(state, "Active jobs require current-revision COMPLETED evidence") }
    }
    const previous = existing.get(job.job_id)
    if (previous === undefined || !samePreparedIdentity(previous, job)) {
      return { ok: false, result: invalid(state, "Completed job identity must match its admitted attempt") }
    }
    completed.set(job.job_id, job)
  }
  const completedHistory = state.job_attempts.map((job) => completed.get(job.job_id) ?? job)
  const committedHistory = completedHistory.map((job) => job.phase === "COMPLETED"
    ? { ...job, phase: "COMMITTED" as const }
    : job)
  return {
    ok: true,
    revision,
    completed_history: completedHistory,
    committed_history: committedHistory,
  }
}

export function abortAfterCompletion(
  state: Extract<ResearchCampaignStateV1, { readonly status: "RUNNING" }>,
  completion: Extract<PreparedCompletion, { readonly ok: true }>,
): CampaignTransitionResult | null {
  if (!state.abort_requested) return null
  return validated(state, {
    ...state,
    state_revision: completion.revision,
    status: "ABORTED",
    active_job_ids: [],
    job_attempts: completion.completed_history,
  })
}

function samePreparedIdentity(left: CampaignJobAttempt, right: CompletedJob): boolean {
  return left.job_id === right.job_id
    && sameTarget(left.target, right.target)
    && left.attempt_number === right.attempt_number
    && left.prepared_at_revision === right.prepared_at_revision
    && left.idempotency_key === right.idempotency_key
    && left.role === right.role
    && left.resolved_model.providerID === right.resolved_model.providerID
    && left.resolved_model.modelID === right.resolved_model.modelID
    && left.resolved_model.variant === right.resolved_model.variant
    && left.profile_sha256 === right.profile_sha256
    && left.prompt_sha256 === right.prompt_sha256
    && left.reference_sha256 === right.reference_sha256
    && left.input_sha256 === right.input_sha256
    && left.child_title === right.child_title
}

function sameTarget(left: CampaignJobAttempt["target"], right: CampaignJobAttempt["target"]): boolean {
  if (left.kind !== right.kind) return false
  switch (left.kind) {
    case "CANDIDATE":
      return right.kind === "CANDIDATE" && left.candidate_id === right.candidate_id
    case "SCREEN":
      return right.kind === "SCREEN" && left.screen_id === right.screen_id && left.candidate_id === right.candidate_id
    case "TOURNAMENT":
      return right.kind === "TOURNAMENT" && left.tournament_id === right.tournament_id
    default:
      return assertNever(left)
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected campaign job target: ${String(value)}`)
}
