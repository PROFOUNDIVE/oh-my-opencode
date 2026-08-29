import { getWorkflowStatus } from "../../workflow/application/get-workflow-status"
import type { CampaignSchedulerResult, CampaignStepDependencies } from "../application"
import { parseFrozenCandidateSources } from "../candidates/frozen-candidate-sources"
import { screenTargetMatchesReference } from "../screening/screen-target"
import { campaignJobForCommit, progressCampaignJobAttempt, type CampaignJobRuntime } from "../scheduler"
import {
  CampaignJobReceiptSchema,
  TournamentReceiptSchema,
  type CampaignJobAttempt,
  type ResearchCampaignStateV1,
  type ScreenNormalizedOutput,
} from "../state"
import { admitTournamentCandidates } from "./tournament-admission"
import { buildTournamentSession, type TournamentCandidateContent } from "./tournament-input"
import { adaptTournamentOutput } from "./tournament-output-adapter"
import { startMergeCandidate } from "./start-merge-candidate"

export type TournamentJobRuntimeFactory = (
  callbacks: Pick<CampaignJobRuntime, "persist_job_attempt" | "block_reconciliation">,
) => CampaignJobRuntime

export async function runTournament(input: Parameters<CampaignStepDependencies["run_operation"]>[0], dependencies: Readonly<{
  readonly directory: string
  readonly create_job_runtime: TournamentJobRuntimeFactory
}>): Promise<CampaignSchedulerResult> {
  if (input.state.status !== "RUNNING" || input.state.phase !== "TOURNAMENT") {
    return failure("ILLEGAL_TRANSITION", "Tournament execution requires RUNNING tournament")
  }
  const admission = admitTournamentCandidates(input.state)
  if (!admission.ok) return failure("VALIDATION_ERROR", admission.message)
  const frozen = parseFrozenCandidateSources(input.state)
  if (!frozen.ok) return failure("VALIDATION_ERROR", frozen.message)
  const attempts = activeTournamentJobs(input.state.job_attempts, input.state.active_job_ids)
  const attempt = attempts[0]
  if (attempts.length !== 1 || attempt === undefined || attempt.target.kind !== "TOURNAMENT") {
    return failure("VALIDATION_ERROR", "Tournament execution requires one active tournament job")
  }
  const tournamentId = attempt.target.tournament_id
  const content = await loadCandidateContent(dependencies.directory, admission.candidates)
  if (!content.ok) return failure("CHILD_WORKFLOW_FAILED", content.message)
  const session = buildTournamentSession(content.candidates)
  const runtime = dependencies.create_job_runtime({
    persist_job_attempt: input.persist_job_attempt,
    block_reconciliation: input.block_reconciliation,
  })
  const progressed = await progressCampaignJobAttempt({
    parent_session_id: input.state.parent_session_id,
    attempt,
    system_content: frozen.sources.profile.tournament_role.prompt.content,
    user_prompt: JSON.stringify(session.payload),
    receipt_from_output: (rawOutput) => {
      const adapted = adaptTournamentOutput(rawOutput, session.label_mapping)
      return adapted.ok
        ? CampaignJobReceiptSchema.parse({ kind: "TOURNAMENT", tournament_id: tournamentId, result: adapted.result })
        : CampaignJobReceiptSchema.parse({ kind: "ERROR", error_code: adapted.error.code, message: adapted.error.message })
    },
    runtime,
  })
  if (progressed.kind !== "completed") {
    const message = progressed.kind === "error" || progressed.kind === "blocked" ? progressed.message : "Tournament output is invalid"
    const blocked = await input.block_reconciliation({ job_id: attempt.job_id, message })
    return blocked.ok ? failure("CHILD_WORKFLOW_FAILED", message) : failure(blocked.error_code, blocked.message)
  }
  const completed = progressed.attempt
  if (completed.receipt.kind !== "TOURNAMENT" || completed.receipt.result === undefined) {
    const message = "Tournament output is invalid"
    const blocked = await input.block_reconciliation({ job_id: attempt.job_id, message })
    return blocked.ok ? failure("CHILD_WORKFLOW_FAILED", message) : failure(blocked.error_code, blocked.message)
  }
  const result = completed.receipt.result
  let mergeCandidate = null
  if (result.kind === "DECIDED" && result.actions.some((action) => action.action === "MERGE_IDEA")) {
    const started = await startMergeCandidate({
      directory: dependencies.directory,
      state: input.state,
      result,
      created_at_revision: completed.phase_revision + 1,
    })
    if (!started.ok) {
      const blocked = await input.block_reconciliation({ job_id: attempt.job_id, message: started.message })
      return blocked.ok ? failure("CHILD_WORKFLOW_FAILED", started.message) : failure(blocked.error_code, blocked.message)
    }
    mergeCandidate = started.candidate
  }
  const revision = completed.phase_revision + 1
  const receipt = TournamentReceiptSchema.parse({
    tournament_id: tournamentId,
    job_id: completed.job_id,
    campaign_revision: revision,
    screen_ids: admission.candidates.flatMap(({ screens }) => screens.map((screen) => screen.screen_id)),
    result,
    reviewer_session_id: completed.child_session_id,
    resolved_model: completed.resolved_model,
    profile_sha256: completed.profile_sha256,
    prompt_sha256: completed.prompt_sha256,
    reference_sha256: completed.reference_sha256,
    raw_output_sha256: completed.raw_output_sha256,
  })
  const transition = await input.commit_transition({
    type: "COMPLETE_TOURNAMENT",
    job_attempts: [campaignJobForCommit(completed, completed.phase_revision)],
    tournament_receipt: receipt,
    merge_candidate: mergeCandidate,
  })
  return transition.ok ? { ok: true } : failure(transition.error_code, transition.message)
}

async function loadCandidateContent(
  directory: string,
  admission: Extract<ReturnType<typeof admitTournamentCandidates>, { readonly ok: true }>["candidates"],
): Promise<Readonly<{ readonly ok: true; readonly candidates: readonly TournamentCandidateContent[] }>
  | Readonly<{ readonly ok: false; readonly message: string }>> {
  const candidates: TournamentCandidateContent[] = []
  for (const admitted of admission) {
    const reference = admitted.candidate.artifact
    if (reference === null) return { ok: false, message: "Tournament candidate artifact reference is absent" }
    const child = await getWorkflowStatus({ directory, run_id: admitted.candidate.child_run_id })
    if (child.kind !== "ok" || child.state.artifact === null
      || !screenTargetMatchesReference(child.state.artifact, reference)) {
      return { ok: false, message: "Tournament candidate artifact no longer matches its discovered reference" }
    }
    candidates.push({
      candidate_id: admitted.candidate.candidate_id,
      artifact_content: child.state.artifact.content,
      screen_summaries: admitted.screens.map(normalizedScreen),
    })
  }
  return { ok: true, candidates }
}

function normalizedScreen(screen: ScreenNormalizedOutput): ScreenNormalizedOutput {
  return {
    verdict: screen.verdict,
    blocking_issues: screen.blocking_issues,
    unresolved_obligations: screen.unresolved_obligations,
    assumptions: screen.assumptions,
    novel_elements: screen.novel_elements,
  }
}

function activeTournamentJobs(
  attempts: readonly CampaignJobAttempt[],
  ids: ResearchCampaignStateV1["active_job_ids"],
): readonly CampaignJobAttempt[] {
  const byId = new Map(attempts.map((attempt) => [attempt.job_id, attempt]))
  return ids.flatMap((id) => byId.get(id) ?? [])
}

function failure(
  error_code: Exclude<CampaignSchedulerResult, { readonly ok: true }>["error_code"],
  message: string,
): Extract<CampaignSchedulerResult, { readonly ok: false }> {
  return { ok: false, error_code, message }
}
