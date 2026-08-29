import type { CampaignSchedulerResult, CampaignStepDependencies } from "../application"
import { campaignJobForCommit, type CampaignJobRuntime } from "../scheduler"
import type { CampaignJobAttempt } from "../state"
import { executeCandidateChild, type CandidateChildExecutionResult } from "./execute-candidate-child"
import { parseFrozenCandidateSources } from "./frozen-candidate-sources"

export type CandidateJobRuntimeFactory = (
  callbacks: Pick<CampaignJobRuntime, "persist_job_attempt" | "block_reconciliation">,
) => CampaignJobRuntime

export async function runCandidateDiscovery(input: Parameters<CampaignStepDependencies["run_operation"]>[0], dependencies: Readonly<{
  readonly directory: string
  readonly create_job_runtime: CandidateJobRuntimeFactory
}>): Promise<CampaignSchedulerResult> {
  if (input.state.status !== "RUNNING" || input.state.phase !== "DISCOVERY") {
    return { ok: false, error_code: "ILLEGAL_TRANSITION", message: "Candidate discovery requires RUNNING discovery" }
  }
  const frozen = parseFrozenCandidateSources(input.state)
  if (!frozen.ok) return { ok: false, error_code: "VALIDATION_ERROR", message: frozen.message }
  if (frozen.sources.profile.candidate_workflow_profile.checkpoint !== "after_solve") {
    return { ok: false, error_code: "VALIDATION_ERROR", message: "Candidate workflow profile must checkpoint after_solve" }
  }

  const jobs = activeCandidateJobs(input.state.job_attempts, input.state.active_job_ids)
  const candidates = new Map(input.state.candidates.map((candidate) => [candidate.candidate_id, candidate]))
  const strategies = new Map(frozen.sources.profile.strategies.map((strategy) => [strategy.id, strategy]))
  const completed: Extract<CandidateChildExecutionResult, { readonly ok: true }>[] = []
  const limit = frozen.sources.profile.max_active_candidates

  for (let offset = 0; offset < jobs.length; offset += limit) {
    const batch = jobs.slice(offset, offset + limit)
    const settled = await Promise.allSettled(batch.map(async (attempt) => {
      const descriptor = attempt.target.kind === "CANDIDATE" ? candidates.get(attempt.target.candidate_id) : undefined
      if (descriptor?.candidate_kind !== "STRATEGY") return childFailure("Candidate discovery job target is invalid")
      const strategy = strategies.get(descriptor.strategy_id)
      if (strategy === undefined) return childFailure("Candidate strategy is absent from the frozen profile")
      return executeCandidateChild({
        directory: dependencies.directory,
        parent_session_id: input.state.parent_session_id,
        descriptor,
        strategy_prompt: strategy.prompt.content,
        sources: frozen.sources,
        attempt,
        job_runtime: dependencies.create_job_runtime({
          persist_job_attempt: input.persist_job_attempt,
          block_reconciliation: input.block_reconciliation,
        }),
      })
    }))
    const rejected = settled.find((result): result is PromiseRejectedResult => result.status === "rejected")
    if (rejected !== undefined) throw rejected.reason
    const outcomes = settled
      .filter((result): result is PromiseFulfilledResult<CandidateChildExecutionResult> => result.status === "fulfilled")
      .map((result) => result.value)
    const failureIndex = outcomes.findIndex((outcome) => !outcome.ok)
    if (failureIndex >= 0) {
      const failure = outcomes[failureIndex]
      const failedJob = batch[failureIndex]
      if (failure === undefined || failure.ok || failedJob === undefined) return childFailure("Candidate failure identity is missing")
      const blocked = await input.block_reconciliation({ job_id: failedJob.job_id, message: failure.message })
      return blocked.ok
        ? failure
        : { ok: false, error_code: blocked.error_code, message: blocked.message }
    }
    completed.push(...outcomes.filter(isCompleted))
  }

  const campaignRevision = completed.reduce((revision, result) => Math.max(revision, result.campaign_state_revision), input.state.state_revision)
  const transition = await input.commit_transition({
    type: "COMPLETE_DISCOVERY",
    job_attempts: completed.map((result) => campaignJobForCommit(result.attempt, campaignRevision)),
    candidates: completed.map((result) => result.candidate),
  })
  return transition.ok
    ? { ok: true }
    : { ok: false, error_code: transition.error_code, message: transition.message }
}

function activeCandidateJobs(
  attempts: readonly CampaignJobAttempt[],
  activeJobIds: readonly CampaignJobAttempt["job_id"][],
): readonly CampaignJobAttempt[] {
  const byId = new Map(attempts.map((attempt) => [attempt.job_id, attempt]))
  return activeJobIds.flatMap((jobId) => {
    const attempt = byId.get(jobId)
    return attempt === undefined ? [] : [attempt]
  })
}

function isCompleted(result: CandidateChildExecutionResult): result is Extract<CandidateChildExecutionResult, { readonly ok: true }> {
  return result.ok
}

function childFailure(message: string): Extract<CandidateChildExecutionResult, { readonly ok: false }> {
  return { ok: false, error_code: "CHILD_WORKFLOW_FAILED", message }
}
