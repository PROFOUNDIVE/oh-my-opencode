import { amendWorkflow } from "../../workflow/application/amend-workflow"
import { getWorkflowStatus } from "../../workflow/application/get-workflow-status"
import { startWorkflowFromSnapshots } from "../../workflow/application/start-workflow-from-snapshots"
import { stepWorkflow } from "../../workflow/application/step-workflow"
import { startWorkflowState } from "../../workflow/storage"
import type { WorkflowStateV1 } from "../../workflow/state"
import type { CampaignErrorCode } from "../application"
import { CampaignJobReceiptSchema, CandidateDescriptorSchema, type CampaignJobAttempt, type CandidateDescriptor } from "../state"
import type { CampaignJobRuntime } from "../scheduler"
import type { FrozenCandidateSources } from "./frozen-candidate-sources"
import { CandidateCampaignPersistenceError, createCandidateWorkflowRuntime } from "./candidate-workflow-runtime"

type CompletedJob = Extract<CampaignJobAttempt, { readonly phase: "COMPLETED" }>

export type CandidateChildExecutionResult =
  | {
      readonly ok: true
      readonly candidate: CandidateDescriptor
      readonly attempt: CompletedJob
      readonly campaign_state_revision: number
    }
  | { readonly ok: false; readonly error_code: CampaignErrorCode; readonly message: string }

export async function executeCandidateChild(input: Readonly<{
  readonly directory: string
  readonly parent_session_id: string
  readonly descriptor: Extract<CandidateDescriptor, { readonly candidate_kind: "STRATEGY" }>
  readonly strategy_prompt: string
  readonly sources: FrozenCandidateSources
  readonly attempt: CampaignJobAttempt
  readonly job_runtime: CampaignJobRuntime
}>): Promise<CandidateChildExecutionResult> {
  const existing = await getWorkflowStatus({ directory: input.directory, run_id: input.descriptor.child_run_id })
  let state: WorkflowStateV1
  if (existing.kind === "ok") {
    if (!sameFrozenInputs(existing.state, input)) return failed("Candidate child run already exists with different frozen inputs")
    state = existing.state
  } else {
    const started = await startWorkflowFromSnapshots({
      directory: input.directory,
      run_id: input.descriptor.child_run_id,
      parent_session_id: input.parent_session_id,
      request_snapshot: input.sources.objective,
      profile_snapshot: input.sources.profile.candidate_workflow_profile,
      reference_snapshot: input.sources.references,
      artifact: undefined,
    }, { start_state: startWorkflowState })
    if (started.kind === "error") return failed(started.message)
    state = started.state
  }

  const amended = await ensureStrategyAmendment(input, state)
  if (!amended.ok) return amended
  state = amended.state

  const candidateRuntime = createCandidateWorkflowRuntime({
    directory: input.directory,
    state,
    attempt: input.attempt,
    job_runtime: input.job_runtime,
  })
  if (!atAfterSolve(state)) {
    try {
      const stepped = await stepWorkflow({
        directory: input.directory,
        run_id: input.descriptor.child_run_id,
        expected_state_revision: state.state_revision,
        mode: "to_checkpoint",
      }, { create_runtime: () => candidateRuntime.runtime })
      if (stepped.kind === "error") return failed(stepped.message)
      state = stepped.state
    } catch (error) {
      if (error instanceof CandidateCampaignPersistenceError) {
        return { ok: false, error_code: error.error_code, message: error.message }
      }
      throw error
    }
  }

  const solveAttempt = completedSolveAttempt(state)
  if (solveAttempt === undefined) return failed("Candidate child did not produce SOLVE completion evidence")
  let campaignAttempt: CampaignJobAttempt
  try {
    campaignAttempt = await candidateRuntime.synchronize_prompt_receipt(solveAttempt.child_session_id)
  } catch (error) {
    if (error instanceof CandidateCampaignPersistenceError) {
      return { ok: false, error_code: error.error_code, message: error.message }
    }
    throw error
  }
  if (campaignAttempt.phase === "PROMPT_SENT") {
    const artifact = state.artifact
    const receipt = artifact === null
      ? CampaignJobReceiptSchema.parse({ kind: "ERROR", error_code: "CHILD_WORKFLOW_FAILED", message: "Candidate child produced no artifact" })
      : CampaignJobReceiptSchema.parse({ kind: "CANDIDATE_ARTIFACT", candidate_id: input.descriptor.candidate_id, artifact_sha256: artifact.sha256 })
    const persisted = await input.job_runtime.persist_job_attempt({
      phase: "COMPLETED",
      job_id: campaignAttempt.job_id,
      child_session_id: solveAttempt.child_session_id,
      raw_output_sha256: solveAttempt.output_hash,
      receipt,
    })
    if (!persisted.ok) return { ok: false, error_code: persisted.error_code, message: persisted.message }
    campaignAttempt = persisted.attempt
    if (campaignAttempt.phase !== "COMPLETED") return failed("Candidate completion persisted an unexpected phase")
    if (artifact === null) return failed("Candidate child produced no artifact")
    return completed(input.descriptor, state, campaignAttempt, persisted.state?.state_revision ?? campaignAttempt.phase_revision)
  }
  if (campaignAttempt.phase !== "COMPLETED") return failed("Candidate campaign job did not reach completion")
  if (state.artifact === null) return failed("Candidate child produced no artifact")
  return completed(input.descriptor, state, campaignAttempt, campaignAttempt.phase_revision)
}

async function ensureStrategyAmendment(
  input: Parameters<typeof executeCandidateChild>[0],
  state: WorkflowStateV1,
): Promise<{ readonly ok: true; readonly state: WorkflowStateV1 } | Extract<CandidateChildExecutionResult, { readonly ok: false }>> {
  const added = state.amendments.find((event) => event.event_type === "ADDED")
  if (added !== undefined) {
    return state.amendments.length === 1
      && added.kind === "scope_change" && added.scope === "all_remaining" && added.content === input.strategy_prompt
      ? { ok: true, state }
      : failed("Candidate child contains an unexpected amendment")
  }
  if (state.state_revision !== 0 || state.status !== "READY" || state.next_stage !== "SOLVE") {
    return failed("Candidate strategy amendment must be added before SOLVE")
  }
  const amended = await amendWorkflow({
    directory: input.directory,
    run_id: input.descriptor.child_run_id,
    expected_state_revision: state.state_revision,
    operation: "add",
    kind: "scope_change",
    scope: "all_remaining",
    content: input.strategy_prompt,
  })
  return amended.kind === "ok" ? { ok: true, state: amended.state } : failed(amended.message)
}

function sameFrozenInputs(state: WorkflowStateV1, input: Parameters<typeof executeCandidateChild>[0]): boolean {
  return state.parent_session_id === input.parent_session_id
    && JSON.stringify(state.request_snapshot) === JSON.stringify(input.sources.objective)
    && JSON.stringify(state.profile_snapshot) === JSON.stringify(input.sources.profile.candidate_workflow_profile)
    && JSON.stringify(state.reference_snapshot) === JSON.stringify(input.sources.references)
}

function atAfterSolve(state: WorkflowStateV1): boolean {
  return state.status === "AWAITING_HUMAN" && state.awaiting_reason === "CHECKPOINT" && state.next_stage === "REVIEW"
}

function completedSolveAttempt(state: WorkflowStateV1) {
  return state.dispatch_attempts.findLast((attempt): attempt is Extract<WorkflowStateV1["dispatch_attempts"][number], { readonly phase: "COMMITTED" }> => (
    attempt.stage === "SOLVE" && attempt.phase === "COMMITTED"
  ))
}

function completed(
  descriptor: Parameters<typeof executeCandidateChild>[0]["descriptor"],
  state: WorkflowStateV1,
  attempt: CompletedJob,
  campaignRevision: number,
): CandidateChildExecutionResult {
  if (!atAfterSolve(state) || state.artifact === null) return failed("Candidate child advanced outside the required after_solve checkpoint")
  return {
    ok: true,
    attempt,
    campaign_state_revision: campaignRevision,
    candidate: CandidateDescriptorSchema.parse({
      ...descriptor,
      child_state_revision: state.state_revision,
      artifact: {
        child_run_id: descriptor.child_run_id,
        child_state_revision: state.state_revision,
        artifact_version: state.artifact.version,
        media_type: state.artifact.media_type,
        sha256: state.artifact.sha256,
      },
    }),
  }
}

function failed(message: string): Extract<CandidateChildExecutionResult, { readonly ok: false }> {
  return { ok: false, error_code: "CHILD_WORKFLOW_FAILED", message }
}
