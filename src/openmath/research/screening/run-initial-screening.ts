import { getWorkflowStatus } from "../../workflow/application/get-workflow-status"
import type { CampaignSchedulerResult, CampaignStepDependencies } from "../application"
import { parseFrozenCandidateSources, type FrozenCandidateSources } from "../candidates/frozen-candidate-sources"
import { campaignJobForCommit, progressCampaignJobAttempt, type CampaignJobRuntime } from "../scheduler"
import {
  CampaignJobReceiptSchema,
  ScreenReceiptSchema,
  type CampaignJobAttempt,
  type ResearchCampaignStateV1,
  type ScreenReceipt,
} from "../state"
import { buildBlindScreenInput } from "./screen-input"
import { adaptScreenOutput } from "./screen-output-adapter"
import { screenTargetMatchesReference } from "./screen-target"

export type ScreeningJobRuntimeFactory = (
  callbacks: Pick<CampaignJobRuntime, "persist_job_attempt" | "block_reconciliation">,
) => CampaignJobRuntime

export async function runInitialScreening(input: Parameters<CampaignStepDependencies["run_operation"]>[0], dependencies: Readonly<{
  readonly directory: string
  readonly create_job_runtime: ScreeningJobRuntimeFactory
}>): Promise<CampaignSchedulerResult> {
  if (input.state.status !== "RUNNING" || input.state.phase !== "SCREENING") {
    return failure("ILLEGAL_TRANSITION", "Initial screening requires RUNNING screening")
  }
  const frozen = parseFrozenCandidateSources(input.state)
  if (!frozen.ok) return failure("VALIDATION_ERROR", frozen.message)
  const jobs = activeJobs(input.state.job_attempts, input.state.active_job_ids)
  const candidates = new Map(input.state.candidates.map((candidate) => [candidate.candidate_id, candidate]))
  const roles = new Map(frozen.sources.profile.screening_roles.map((role) => [role.id, role]))
  const completed: ScreenExecutionSuccess[] = []
  const runtime = dependencies.create_job_runtime({
    persist_job_attempt: input.persist_job_attempt,
    block_reconciliation: input.block_reconciliation,
  })
  const limit = frozen.sources.profile.max_active_candidates
  for (let offset = 0; offset < jobs.length; offset += limit) {
    const batch = jobs.slice(offset, offset + limit)
    const settled = await Promise.allSettled(batch.map((attempt) => executeScreen({
      attempt,
      directory: dependencies.directory,
      parent_session_id: input.state.parent_session_id,
      candidates,
      roles,
      objective: frozen.sources.objective,
      references: frozen.sources.references,
      runtime,
    })))
    const rejected = settled.find((result): result is PromiseRejectedResult => result.status === "rejected")
    if (rejected !== undefined) throw rejected.reason
    const outcomes = settled
      .filter((result): result is PromiseFulfilledResult<ScreenExecutionResult> => result.status === "fulfilled")
      .map((result) => result.value)
    const failedIndex = outcomes.findIndex((outcome) => !outcome.ok)
    if (failedIndex >= 0) {
      const outcome = outcomes[failedIndex]
      const failedJob = batch[failedIndex]
      if (outcome === undefined || outcome.ok || failedJob === undefined) return failure("CHILD_WORKFLOW_FAILED", "Screen failure identity is missing")
      const blocked = await input.block_reconciliation({ job_id: failedJob.job_id, message: outcome.message })
      return blocked.ok ? outcome : failure(blocked.error_code, blocked.message)
    }
    completed.push(...outcomes.filter(isScreenSuccess))
  }
  const currentRevision = completed.reduce((revision, result) => Math.max(revision, result.attempt.phase_revision), input.state.state_revision)
  const revision = currentRevision + 1
  const transition = await input.commit_transition({
    type: "COMPLETE_SCREENING",
    job_attempts: completed.map((result) => campaignJobForCommit(result.attempt, currentRevision)),
    screen_receipts: completed.map((result) => ScreenReceiptSchema.parse({ ...result.receipt, campaign_revision: revision })),
  })
  return transition.ok ? { ok: true } : failure(transition.error_code, transition.message)
}

type CompletedJob = Extract<CampaignJobAttempt, { readonly phase: "COMPLETED" }>
type ScreenExecutionSuccess = Readonly<{ readonly ok: true; readonly attempt: CompletedJob; readonly receipt: ScreenReceipt }>
type ScreenExecutionResult = ScreenExecutionSuccess | Extract<CampaignSchedulerResult, { readonly ok: false }>

async function executeScreen(input: Readonly<{
  readonly attempt: CampaignJobAttempt
  readonly directory: string
  readonly parent_session_id: string
  readonly candidates: ReadonlyMap<string, ResearchCampaignStateV1["candidates"][number]>
  readonly roles: ReadonlyMap<string, FrozenCandidateSources["profile"]["screening_roles"][number]>
  readonly objective: Parameters<typeof buildBlindScreenInput>[0]["objective"]
  readonly references: Parameters<typeof buildBlindScreenInput>[0]["references"]
  readonly runtime: CampaignJobRuntime
}>): Promise<ScreenExecutionResult> {
  if (input.attempt.target.kind !== "SCREEN") return failure("VALIDATION_ERROR", "Screen job target is invalid")
  const screenId = input.attempt.target.screen_id
  const candidate = input.candidates.get(input.attempt.target.candidate_id)
  if (candidate?.artifact === null || candidate === undefined) return failure("VALIDATION_ERROR", "Screen candidate artifact is absent")
  const role = [...input.roles.entries()].find(([roleId]) => screenId === `screen-${candidate.candidate_id}-${roleId}`)?.[1]
  if (role === undefined) return failure("VALIDATION_ERROR", "Screen role is absent from the frozen profile")
  const child = await getWorkflowStatus({ directory: input.directory, run_id: candidate.child_run_id })
  if (child.kind !== "ok" || child.state.artifact === null) return failure("CHILD_WORKFLOW_FAILED", "Screen target artifact is unavailable")
  if (!screenTargetMatchesReference(child.state.artifact, candidate.artifact)) {
    return failure("CHILD_WORKFLOW_FAILED", "Screen target artifact no longer matches its discovered reference")
  }
  const userPrompt = JSON.stringify(buildBlindScreenInput({
    objective: input.objective,
    references: input.references,
    target_artifact: child.state.artifact,
    screening_instructions: role.prompt.content,
  }))
  const progressed = await progressCampaignJobAttempt({
    parent_session_id: input.parent_session_id,
    attempt: input.attempt,
    system_content: undefined,
    user_prompt: userPrompt,
    receipt_from_output: (rawOutput) => {
      const adapted = adaptScreenOutput(rawOutput)
      return adapted.ok
        ? CampaignJobReceiptSchema.parse({ kind: "SCREEN", screen_id: screenId, normalized_output: adapted.output })
        : CampaignJobReceiptSchema.parse({ kind: "ERROR", error_code: adapted.error.code, message: adapted.error.message })
    },
    runtime: input.runtime,
  })
  if (progressed.kind !== "completed" || progressed.attempt.receipt.kind !== "SCREEN") {
    const message = progressed.kind === "error" || progressed.kind === "blocked" ? progressed.message : "Screen output is invalid"
    return failure(progressed.kind === "error" ? progressed.error_code : "CHILD_WORKFLOW_FAILED", message)
  }
  return { ok: true, attempt: progressed.attempt, receipt: screenReceipt(progressed.attempt, candidate.artifact, role.id) }
}

function isScreenSuccess(result: ScreenExecutionResult): result is ScreenExecutionSuccess {
  return result.ok
}

function screenReceipt(job: CompletedJob, artifact: NonNullable<ScreenReceipt["artifact"]>, role: string): ScreenReceipt {
  if (job.target.kind !== "SCREEN" || job.receipt.kind !== "SCREEN" || job.receipt.normalized_output === undefined) throw new TypeError("Invalid screen completion")
  return ScreenReceiptSchema.parse({
    screen_id: job.target.screen_id, job_id: job.job_id, campaign_revision: job.phase_revision,
    candidate_id: job.target.candidate_id, artifact, screen_role: role, ...job.receipt.normalized_output,
    reviewer_session_id: job.child_session_id, resolved_model: job.resolved_model,
    profile_sha256: job.profile_sha256, prompt_sha256: job.prompt_sha256,
    reference_sha256: job.reference_sha256, raw_output_sha256: job.raw_output_sha256,
  })
}

function activeJobs(
  attempts: readonly CampaignJobAttempt[],
  ids: ResearchCampaignStateV1["active_job_ids"],
): readonly CampaignJobAttempt[] {
  const byId = new Map(attempts.map((attempt) => [attempt.job_id, attempt]))
  return ids.flatMap((id) => byId.get(id) ?? [])
}

function failure(
  error_code: Parameters<typeof resultFailure>[0],
  message: string,
): Extract<CampaignSchedulerResult, { readonly ok: false }> {
  return resultFailure(error_code, message)
}

function resultFailure(error_code: Exclude<CampaignSchedulerResult, { readonly ok: true }>["error_code"], message: string): Extract<CampaignSchedulerResult, { readonly ok: false }> {
  return { ok: false, error_code, message }
}
