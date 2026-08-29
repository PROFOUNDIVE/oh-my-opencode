import { amendWorkflow } from "../../workflow/application/amend-workflow"
import { getWorkflowStatus } from "../../workflow/application/get-workflow-status"
import { startWorkflowFromSnapshots } from "../../workflow/application/start-workflow-from-snapshots"
import { startWorkflowState } from "../../workflow/storage"
import { sha256 } from "../../workflow/stage-runner/sha256"
import { parseFrozenCandidateSources } from "../candidates/frozen-candidate-sources"
import {
  CampaignHashSchema,
  CandidateDescriptorSchema,
  CandidateIdSchema,
  ChildRunIdSchema,
  type CandidateDescriptor,
  type ResearchCampaignStateV1,
  type TournamentResult,
} from "../state"

export type StartMergeCandidateResult =
  | Readonly<{ readonly ok: true; readonly candidate: CandidateDescriptor }>
  | Readonly<{ readonly ok: false; readonly message: string }>

export async function startMergeCandidate(input: Readonly<{
  readonly directory: string
  readonly state: ResearchCampaignStateV1
  readonly result: Extract<TournamentResult, { readonly kind: "DECIDED" }>
  readonly created_at_revision: number
}>): Promise<StartMergeCandidateResult> {
  const brief = input.result.synthesis_brief
  const briefHash = input.result.synthesis_brief_sha256
  const parentIds = input.result.actions
    .filter((action) => action.action === "MERGE_IDEA")
    .map((action) => action.candidate_id)
  if (brief === null || briefHash === null || parentIds.length < 2
    || CampaignHashSchema.parse(sha256(brief)) !== briefHash) {
    return invalid("Merge directive requires an exact hash-bound synthesis brief and at least two parents")
  }
  const parents = parentIds.map((id) => input.state.candidates.find((candidate) => candidate.candidate_id === id))
  if (new Set(parentIds).size !== parentIds.length || parents.some((parent) => parent?.candidate_kind !== "STRATEGY")) {
    return invalid("Merge parents must be distinct admitted strategy candidates")
  }
  const candidateId = CandidateIdSchema.parse("merged-01")
  if (input.state.candidates.some((candidate) => candidate.candidate_id === candidateId)) {
    return invalid("Phase A permits only one fresh merge candidate")
  }
  const childRunId = ChildRunIdSchema.parse(`${input.state.campaign_id}::${candidateId}`)
  const frozen = parseFrozenCandidateSources(input.state)
  if (!frozen.ok) return invalid(frozen.message)
  const existing = await getWorkflowStatus({ directory: input.directory, run_id: childRunId })
  let childState
  if (existing.kind === "ok") {
    if (existing.state.parent_session_id !== input.state.parent_session_id
      || JSON.stringify(existing.state.request_snapshot) !== JSON.stringify(frozen.sources.objective)
      || JSON.stringify(existing.state.profile_snapshot) !== JSON.stringify(frozen.sources.profile.candidate_workflow_profile)
      || JSON.stringify(existing.state.reference_snapshot) !== JSON.stringify(frozen.sources.references)
      || existing.state.artifact !== null) {
      return invalid("Merge child already exists with different frozen inputs")
    }
    childState = existing.state
  } else {
    if (existing.error_code !== "RUN_NOT_FOUND") return invalid(existing.message)
    const started = await startWorkflowFromSnapshots({
      directory: input.directory,
      run_id: childRunId,
      parent_session_id: input.state.parent_session_id,
      request_snapshot: frozen.sources.objective,
      profile_snapshot: frozen.sources.profile.candidate_workflow_profile,
      reference_snapshot: frozen.sources.references,
      artifact: undefined,
    }, { start_state: startWorkflowState })
    if (started.kind === "error") return invalid(started.message)
    childState = started.state
  }
  const added = childState.amendments.find((event) => event.event_type === "ADDED")
  if (added === undefined) {
    if (childState.state_revision !== 0 || childState.status !== "READY" || childState.next_stage !== "SOLVE") {
      return invalid("Merge synthesis brief must be added before SOLVE")
    }
    const amended = await amendWorkflow({
      directory: input.directory,
      run_id: childRunId,
      expected_state_revision: childState.state_revision,
      operation: "add",
      kind: "scope_change",
      scope: "all_remaining",
      content: brief,
    })
    if (amended.kind === "error") return invalid(amended.message)
    childState = amended.state
  } else if (childState.state_revision !== 1 || childState.status !== "READY" || childState.next_stage !== "SOLVE"
    || childState.amendments.length !== 1 || added.state_revision !== 1 || added.kind !== "scope_change"
    || added.scope !== "all_remaining" || added.content !== brief) {
    return invalid("Merge child contains an unexpected amendment")
  }
  return {
    ok: true,
    candidate: CandidateDescriptorSchema.parse({
      candidate_kind: "MERGE_IDEA",
      candidate_id: candidateId,
      created_at_revision: input.created_at_revision,
      child_run_id: childRunId,
      child_state_revision: childState.state_revision,
      artifact: null,
      parent_candidate_ids: parentIds,
      synthesis_brief: brief,
      synthesis_brief_sha256: briefHash,
      attachments: [],
    }),
  }
}

function invalid(message: string): Extract<StartMergeCandidateResult, { readonly ok: false }> {
  return { ok: false, message }
}
