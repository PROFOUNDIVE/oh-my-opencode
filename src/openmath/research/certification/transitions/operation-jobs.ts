import type { CertificationJobAttempt } from "../state/jobs"
import type { ResearchCertificationStateV1 } from "../state/schema"
import { certificationAmendmentConsumptionEvents, certificationAmendmentsApplyToJobs } from "./amendments"
import { certificationFailure, certificationSuccess } from "./transition-result"
import type { CertificationTransitionEvent, CertificationTransitionResult } from "./types"

type PrepareEvent = Extract<CertificationTransitionEvent, { readonly type: "PREPARE_OPERATION" }>
type RunningState = Extract<ResearchCertificationStateV1, { readonly status: "RUNNING" }>
type CompletedJob = Extract<CertificationJobAttempt, { readonly phase: "COMPLETED" }>
type CommittedJob = Extract<CertificationJobAttempt, { readonly phase: "COMMITTED" }>

export type CertificationOperationCompletion =
  | Readonly<{
      readonly ok: true
      readonly revision: number
      readonly committed_jobs: readonly CommittedJob[]
      readonly job_history: readonly CertificationJobAttempt[]
    }>
  | Readonly<{ readonly ok: false; readonly result: CertificationTransitionResult }>

export function reducePrepareCertificationOperation(
  state: ResearchCertificationStateV1,
  event: PrepareEvent,
): CertificationTransitionResult {
  if (state.status === "RUNNING" || state.status === "COMPLETE" || state.status === "ABORTED") {
    return certificationFailure(state, "ILLEGAL_TRANSITION", "Certification status cannot prepare an operation")
  }
  const revision = state.certification_revision + 1
  const consumed = certificationAmendmentConsumptionEvents(state, event.consume_amendment_ids, revision)
  const targetKinds = new Set(event.job_attempts.map((job) => job.target.kind))
  const phaseMatches = event.job_attempts.every((job) => targetMatchesPhase(state.phase, job))
    || event.consume_amendment_ids.length > 0
      && certificationAmendmentsApplyToJobs(state, event.consume_amendment_ids, event.job_attempts)
  if (event.job_attempts.length === 0 || targetKinds.size !== 1 || consumed === null
    || state.status === "AWAITING_HUMAN" && consumed.length === 0
    || event.job_attempts.some((job) => job.phase !== "PREPARED" || job.prepared_at_revision !== revision
      || job.phase_revision !== revision || !jobMatchesState(state, job)) || !phaseMatches) {
    return certificationFailure(state, "VALIDATION_ERROR", "Prepared jobs must exactly bind the current certification operation")
  }
  return certificationSuccess(state, {
    ...state,
    certification_revision: revision,
    phase: operationPhase(event.job_attempts[0]),
    status: "RUNNING",
    awaiting_reason: null,
    abort_requested: false,
    abort_reason: null,
    blocked_reason: null,
    active_job_ids: event.job_attempts.map((job) => job.job_id),
    amendments: [...state.amendments, ...consumed],
    job_attempts: [...state.job_attempts, ...event.job_attempts],
  })
}

function operationPhase(job: CertificationJobAttempt | undefined): ResearchCertificationStateV1["phase"] {
  if (job === undefined) return "EXTRACTION"
  switch (job.target.kind) {
    case "EXTRACTION": return "EXTRACTION"
    case "COVERAGE": return "COVERAGE_REVIEW"
    case "ATTACK": return "COUNTEREXAMPLE_ATTACK"
    case "WITNESS": return "WITNESS_VERIFICATION"
    default: return assertNever(job.target)
  }
}

export function completeCertificationOperation(
  state: ResearchCertificationStateV1,
  completedJobs: readonly CertificationJobAttempt[],
): CertificationOperationCompletion {
  if (state.status !== "RUNNING") {
    return { ok: false, result: certificationFailure(state, "ILLEGAL_TRANSITION", "Only a running certification operation can commit") }
  }
  const revision = state.certification_revision + 1
  const prepared = new Map(state.job_attempts
    .filter((job) => state.active_job_ids.includes(job.job_id))
    .map((job) => [job.job_id, job]))
  if (completedJobs.length !== state.active_job_ids.length || new Set(completedJobs.map((job) => job.job_id)).size !== completedJobs.length) {
    return invalidCompletion(state)
  }
  const completed: CompletedJob[] = []
  for (const job of completedJobs) {
    const previous = prepared.get(job.job_id)
    if (job.phase !== "COMPLETED" || previous === undefined
      || !completionRevisionMatches(previous, job, state.certification_revision, revision)
      || !samePreparedIdentity(previous, job)) {
      return invalidCompletion(state)
    }
    completed.push(job)
  }
  const byId = new Map(completed.map((job) => [job.job_id, { ...job, phase: "COMMITTED" as const, phase_revision: revision }]))
  const history = state.job_attempts.map((job) => byId.get(job.job_id) ?? job)
  return { ok: true, revision, committed_jobs: [...byId.values()], job_history: history }
}

function completionRevisionMatches(
  previous: CertificationJobAttempt,
  completed: CompletedJob,
  currentRevision: number,
  commitRevision: number,
): boolean {
  switch (previous.phase) {
    case "PREPARED": return completed.phase_revision === commitRevision
    case "COMPLETED": return completed.phase_revision === currentRevision
    case "SESSION_CREATED":
    case "PROMPT_SENT":
    case "COMMITTED": return false
    default: return assertNever(previous)
  }
}

function jobMatchesState(state: ResearchCertificationStateV1, job: CertificationJobAttempt): boolean {
  return job.certification_id === state.certification_id && job.generation_id === state.generation_id
    && job.campaign_id === state.campaign_id && job.certification_profile_sha256 === state.certification_profile_sha256
    && job.reference_sha256 === state.reference_sha256
    && job.target.artifact_sha256 === state.selected_artifact.artifact_sha256
}

function targetMatchesPhase(phase: ResearchCertificationStateV1["phase"], job: CertificationJobAttempt): boolean {
  switch (phase) {
    case "EXTRACTION": return job.target.kind === "EXTRACTION"
    case "COVERAGE_REVIEW": return job.target.kind === "COVERAGE"
    case "COUNTEREXAMPLE_ATTACK": return job.target.kind === "ATTACK"
    case "WITNESS_VERIFICATION": return job.target.kind === "WITNESS"
    case "COMPLETE": return false
    default: return assertNever(phase)
  }
}

function samePreparedIdentity(previous: CertificationJobAttempt, completed: CompletedJob): boolean {
  if (previous.phase !== "PREPARED" && previous.phase !== "COMPLETED") return false
  const stableIdentityMatches = previous.job_id === completed.job_id
    && previous.job_kind === completed.job_kind && JSON.stringify(previous.target) === JSON.stringify(completed.target)
    && previous.certification_id === completed.certification_id && previous.generation_id === completed.generation_id
    && previous.campaign_id === completed.campaign_id
    && previous.attempt_number === completed.attempt_number && previous.prepared_at_revision === completed.prepared_at_revision
    && previous.idempotency_key === completed.idempotency_key && previous.role === completed.role
    && JSON.stringify(previous.resolved_model) === JSON.stringify(completed.resolved_model)
    && previous.certification_profile_sha256 === completed.certification_profile_sha256
    && previous.prompt_sha256 === completed.prompt_sha256 && previous.reference_sha256 === completed.reference_sha256
    && previous.input_sha256 === completed.input_sha256 && previous.child_title === completed.child_title
  if (!stableIdentityMatches || previous.phase === "PREPARED") return stableIdentityMatches
  return previous.child_session_id === completed.child_session_id
    && previous.raw_output_sha256 === completed.raw_output_sha256
    && JSON.stringify(previous.receipt) === JSON.stringify(completed.receipt)
}

function invalidCompletion(state: RunningState): CertificationOperationCompletion {
  return { ok: false, result: certificationFailure(state, "VALIDATION_ERROR", "Completed jobs must exactly match active prepared jobs") }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected certification operation phase: ${String(value)}`)
}
