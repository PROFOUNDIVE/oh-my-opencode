import { getWorkflowStatus } from "../../workflow/application/get-workflow-status"
import { amendWorkflow } from "../../workflow/application/amend-workflow"
import { stepWorkflow } from "../../workflow/application/step-workflow"
import type { WorkflowStateV1 } from "../../workflow/state"
import type { CampaignSchedulerResult, CampaignStepDependencies } from "../application"
import {
  CandidateCampaignPersistenceError,
  createCandidateWorkflowRuntime,
} from "../candidates/candidate-workflow-runtime"
import { CampaignJobReceiptSchema, type CampaignJobAttempt } from "../state"
import { campaignJobForCommit, type CampaignJobRuntime } from "../scheduler"
import { renderApplicableCampaignAmendments } from "../transitions"
import { mapWorkflowRefinementOutcome } from "./map-workflow-refinement-outcome"
import { validateSelectedChildState } from "./selected-child-state"

export type RefinementJobRuntimeFactory = (
  callbacks: Pick<CampaignJobRuntime, "persist_job_attempt" | "block_reconciliation">,
) => CampaignJobRuntime

export async function runSelectedRefinement(
  input: Parameters<CampaignStepDependencies["run_operation"]>[0],
  dependencies: Readonly<{ readonly directory: string; readonly create_job_runtime: RefinementJobRuntimeFactory }>,
): Promise<CampaignSchedulerResult> {
  if (input.state.status !== "RUNNING" || input.state.phase !== "DEEP_REFINEMENT") {
    return failure("ILLEGAL_TRANSITION", "Selected refinement requires RUNNING deep refinement")
  }
  const selected = input.state.candidates.filter((candidate) => candidate.candidate_id === input.state.selected_candidate_id)
  const candidate = selected[0]
  const attempts = activeCandidateJobs(input.state.job_attempts, input.state.active_job_ids)
  const attempt = attempts[0]
  if (selected.length !== 1 || candidate === undefined || attempts.length !== 1 || attempt === undefined) {
    return failure("VALIDATION_ERROR", "Selected refinement requires exactly one selected candidate job")
  }
  const current = await getWorkflowStatus({ directory: dependencies.directory, run_id: candidate.child_run_id })
  if (current.kind !== "ok") return block(input, attempt, current.message)
  const validation = validateSelectedChildState({ campaign: input.state, candidate, child: current.state })
  if (!validation.ok) return block(input, attempt, validation.message)
  let child = current.state
  const amendments = renderApplicableCampaignAmendments(input.state, "DEEP_REFINEMENT")
  for (const amendment of amendments.slice(validation.forwarded_amendment_count)) {
    const forwarded = await amendWorkflow({
      directory: dependencies.directory,
      run_id: child.run_id,
      expected_state_revision: child.state_revision,
      operation: "add",
      kind: amendment.kind,
      scope: "all_remaining",
      content: amendment.content,
    })
    if (forwarded.kind === "error") return block(input, attempt, forwarded.message)
    child = forwarded.state
  }
  const jobRuntime = dependencies.create_job_runtime({
    persist_job_attempt: input.persist_job_attempt,
    block_reconciliation: input.block_reconciliation,
  })
  const runtime = createCandidateWorkflowRuntime({
    directory: dependencies.directory,
    state: child,
    attempt,
    job_runtime: jobRuntime,
  })
  try {
    if (attempt.phase !== "COMPLETED") {
      if (candidate.candidate_kind === "MERGE_IDEA" && candidate.artifact === null) {
        const solved = await runChildStep(dependencies.directory, child, runtime.runtime)
        if (solved.kind === "error") return block(input, attempt, solved.message)
        child = solved.state
        if (!atAfterSolve(child)) return block(input, attempt, "Merge child did not reach the after_solve checkpoint")
      } else if (!atAfterSolve(child) && child.status !== "AWAITING_HUMAN" && child.status !== "RUNNING") {
        return block(input, attempt, "Selected KEEP child is not at its authoritative refinement boundary")
      }
      const refined = await runChildStep(dependencies.directory, child, runtime.runtime)
      if (refined.kind === "error") return block(input, attempt, refined.message)
      child = refined.state
    }
  } catch (error) {
    if (error instanceof CandidateCampaignPersistenceError) {
      return failure(error.error_code, error.message)
    }
    throw error
  }
  const outcome = mapWorkflowRefinementOutcome(candidate, child)
  if (!outcome.ok) return block(input, attempt, outcome.message)
  if (outcome.child_result.status === "BLOCKED") {
    return block(input, attempt, outcome.child_result.reason)
  }
  const completed = await completeCampaignAttempt(runtime.campaign_attempt(), child, candidate, jobRuntime)
  if (!completed.ok) return failure(completed.error_code, completed.message)
  const transition = await input.commit_transition({
    type: "COMPLETE_CHILD_WORKFLOW",
    job_attempts: [campaignJobForCommit(completed.attempt, completed.attempt.phase_revision)],
    child_result: outcome.child_result,
  })
  return transition.ok ? { ok: true } : failure(transition.error_code, transition.message)
}

async function runChildStep(
  directory: string,
  state: WorkflowStateV1,
  runtime: Parameters<typeof stepWorkflow>[1]["create_runtime"] extends (state: WorkflowStateV1) => infer R ? NonNullable<R> : never,
) {
  return stepWorkflow({
    directory,
    run_id: state.run_id,
    expected_state_revision: state.state_revision,
    mode: "to_checkpoint",
  }, { create_runtime: () => runtime })
}

async function completeCampaignAttempt(
  attempt: CampaignJobAttempt,
  child: WorkflowStateV1,
  candidate: Parameters<typeof mapWorkflowRefinementOutcome>[0],
  runtime: CampaignJobRuntime,
) {
  if (attempt.phase === "COMPLETED") return { ok: true as const, attempt }
  if (attempt.phase !== "PROMPT_SENT") return failure("CHILD_WORKFLOW_FAILED", "Refinement did not persist a campaign prompt receipt")
  const workflowAttempt = child.dispatch_attempts.findLast((item): item is Extract<WorkflowStateV1["dispatch_attempts"][number], { readonly phase: "COMMITTED" }> => (
    item.phase === "COMMITTED" && item.stage === "REVIEW"
  ))
  if (workflowAttempt === undefined) return failure("CHILD_WORKFLOW_FAILED", "Refinement review evidence is absent from child history")
  const receipt = child.artifact === null
    ? CampaignJobReceiptSchema.parse({ kind: "ERROR", error_code: child.status, message: `Child workflow ended ${child.status}` })
    : CampaignJobReceiptSchema.parse({
      kind: "CANDIDATE_ARTIFACT",
      candidate_id: candidate.candidate_id,
      artifact_sha256: child.artifact.sha256,
      ...(candidate.artifact === null ? {} : { predecessor_artifact: candidate.artifact }),
      refined_artifact: {
        child_run_id: candidate.child_run_id,
        child_state_revision: child.state_revision,
        artifact_version: child.artifact.version,
        media_type: child.artifact.media_type,
        sha256: child.artifact.sha256,
      },
    })
  const persisted = await runtime.persist_job_attempt({
    phase: "COMPLETED",
    job_id: attempt.job_id,
    child_session_id: attempt.child_session_id,
    raw_output_sha256: workflowAttempt.output_hash,
    receipt,
  })
  return persisted.ok && persisted.attempt.phase === "COMPLETED"
    ? { ok: true as const, attempt: persisted.attempt }
    : persisted.ok
      ? failure("CHILD_WORKFLOW_FAILED", "Refinement completion persisted an unexpected phase")
      : persisted
}

async function block(
  input: Parameters<CampaignStepDependencies["run_operation"]>[0],
  attempt: CampaignJobAttempt,
  message: string,
): Promise<Extract<CampaignSchedulerResult, { readonly ok: false }>> {
  const blocked = await input.block_reconciliation({ job_id: attempt.job_id, message })
  return blocked.ok ? failure("CHILD_WORKFLOW_FAILED", message) : failure(blocked.error_code, blocked.message)
}

function atAfterSolve(state: WorkflowStateV1): boolean {
  return state.status === "AWAITING_HUMAN" && state.awaiting_reason === "CHECKPOINT" && state.next_stage === "REVIEW"
}

function activeCandidateJobs(attempts: readonly CampaignJobAttempt[], activeIds: readonly string[]): readonly CampaignJobAttempt[] {
  return attempts.filter((attempt) => activeIds.includes(attempt.job_id) && attempt.target.kind === "CANDIDATE")
}

function failure(
  error_code: Extract<CampaignSchedulerResult, { readonly ok: false }>["error_code"],
  message: string,
): Extract<CampaignSchedulerResult, { readonly ok: false }> {
  return { ok: false, error_code, message }
}
