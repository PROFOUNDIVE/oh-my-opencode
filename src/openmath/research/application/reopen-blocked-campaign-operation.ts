import {
  CampaignJobAttemptSchema,
  CampaignJobIdSchema,
  ResearchCampaignStateV1Schema,
  type CampaignJobAttempt,
  type ResearchCampaignStateV1,
} from "../state"
import { prepareCampaignJobAttempt } from "../scheduler/prepare-campaign-job-attempt"
import { sha256 } from "../../workflow/stage-runner/sha256"

export type ReopenBlockedCampaignOperationResult =
  | { readonly ok: true; readonly state: Extract<ResearchCampaignStateV1, { readonly status: "RUNNING" }> }
  | { readonly ok: false; readonly message: string }

export function reopenBlockedCampaignOperation(
  state: Extract<ResearchCampaignStateV1, { readonly status: "BLOCKED" }>,
): ReopenBlockedCampaignOperationResult {
  const activeTargets = new Set<string>()
  for (const attempt of state.job_attempts) {
    if (attempt.phase === "COMMITTED") continue
    let targetIdentity: string
    switch (attempt.target.kind) {
      case "CANDIDATE":
        targetIdentity = `CANDIDATE:${attempt.target.candidate_id}`
        break
      case "SCREEN":
        targetIdentity = `SCREEN:${attempt.target.screen_id}:${attempt.target.candidate_id}`
        break
      case "TOURNAMENT":
        targetIdentity = `TOURNAMENT:${attempt.target.tournament_id}`
        break
      default:
        return assertNever(attempt.target)
    }
    if (activeTargets.has(targetIdentity)) {
      return { ok: false, message: "Blocked campaign has multiple retry candidates for one job target" }
    }
    activeTargets.add(targetIdentity)
  }
  const terminalFailure = state.job_attempts.find((attempt) => (
    attempt.phase === "COMPLETED"
    && attempt.receipt.kind === "ERROR"
    && attempt.receipt.error_code !== "SUBAGENT_FAILED"
  ))
  if (terminalFailure?.phase === "COMPLETED" && terminalFailure.receipt.kind === "ERROR") {
    return {
      ok: false,
      message: `Campaign job ${terminalFailure.job_id} has unrecoverable terminal error ${terminalFailure.receipt.error_code}: ${terminalFailure.receipt.message}`,
    }
  }
  const nextRevision = state.state_revision + 1
  const retryAttempts: CampaignJobAttempt[] = []
  const archivedJobIds = new Set<CampaignJobAttempt["job_id"]>()
  const activeJobIds = state.job_attempts.flatMap((attempt) => {
    if (attempt.phase === "COMMITTED") return []
    if (attempt.phase !== "COMPLETED" || attempt.receipt.kind !== "ERROR" || attempt.receipt.error_code !== "SUBAGENT_FAILED") {
      return [attempt.job_id]
    }
    const retryJobId = CampaignJobIdSchema.parse(`job-retry-${sha256(`${attempt.job_id}|${attempt.attempt_number + 1}`)}`)
    const retry = prepareCampaignJobAttempt({
      state,
      job_id: retryJobId,
      target: attempt.target,
      role: attempt.role,
      resolved_model: attempt.resolved_model,
      profile_sha256: attempt.profile_sha256,
      prompt_sha256: attempt.prompt_sha256,
      reference_sha256: attempt.reference_sha256,
      input_sha256: attempt.input_sha256,
    })
    archivedJobIds.add(attempt.job_id)
    retryAttempts.push(retry)
    return [retry.job_id]
  })
  if (activeJobIds.length === 0) return { ok: false, message: "Blocked campaign has no recorded job to reconcile" }
  const jobAttempts = state.job_attempts.map((attempt) => archivedJobIds.has(attempt.job_id)
    ? CampaignJobAttemptSchema.parse({ ...attempt, phase: "COMMITTED", phase_revision: nextRevision })
    : attempt)
  const parsed = ResearchCampaignStateV1Schema.parse({
    ...state,
    state_revision: nextRevision,
    status: "RUNNING",
    blocked_reason: null,
    active_job_ids: activeJobIds,
    job_attempts: [...jobAttempts, ...retryAttempts],
  })
  if (parsed.status !== "RUNNING") throw new TypeError("Reopened campaign operation parsed to an unexpected status")
  return { ok: true, state: parsed }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected campaign job target: ${String(value)}`)
}
