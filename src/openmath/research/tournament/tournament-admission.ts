import { parseFrozenCandidateSources } from "../candidates/frozen-candidate-sources"
import { aggregateScreening } from "../screening/screening-aggregation"
import { validateCompleteScreeningMatrix } from "../screening/screening-barrier"
import type { CandidateDescriptor, ResearchCampaignStateV1, ScreenReceipt } from "../state"

type CandidateWithArtifact = CandidateDescriptor & {
  readonly artifact: NonNullable<CandidateDescriptor["artifact"]>
}

export type TournamentAdmissionCandidate = Readonly<{
  readonly candidate: CandidateDescriptor
  readonly screens: readonly ScreenReceipt[]
}>

export type TournamentAdmissionResult =
  | Readonly<{ readonly ok: true; readonly candidates: readonly TournamentAdmissionCandidate[] }>
  | Readonly<{ readonly ok: false; readonly message: string }>

export function admitTournamentCandidates(state: ResearchCampaignStateV1): TournamentAdmissionResult {
  if (!atTournamentBoundary(state)) return invalid("Tournament admission requires an explicit screening checkpoint resumption")
  if (state.candidates.some((candidate) => candidate.candidate_kind === "MERGE_IDEA")) {
    return invalid("Phase A permits no recursive or second merge")
  }
  if (state.tournament_receipts.some((receipt) => receipt.result.kind === "DECIDED")) {
    return invalid("A decided tournament cannot be admitted again")
  }
  const frozen = parseFrozenCandidateSources(state)
  if (!frozen.ok) return invalid(frozen.message)
  const candidates = state.candidates.filter(hasArtifact)
  const jobs = state.job_attempts.filter((job) => job.target.kind === "SCREEN")
  const roleIds = frozen.sources.profile.screening_roles.map((role) => role.id)
  const barrierError = validateCompleteScreeningMatrix({
    candidates,
    role_ids: roleIds,
    jobs,
    receipts: state.screen_receipts,
  })
  if (barrierError !== null) return invalid(barrierError)
  const provenanceError = validateScreenProvenance(state, candidates)
  if (provenanceError !== null) return invalid(provenanceError)
  const aggregation = aggregateScreening(candidates, state.screen_receipts, frozen.sources.profile.survivor_limit)
  if (aggregation.survivor_ids.length === 0) return invalid("Tournament admission requires at least one fixed survivor")
  const survivorIds = new Set(aggregation.survivor_ids)
  return {
    ok: true,
    candidates: candidates
      .filter((candidate) => survivorIds.has(candidate.candidate_id))
      .map((candidate) => ({
        candidate,
        screens: roleIds.flatMap((roleId) => state.screen_receipts.filter((receipt) => (
          receipt.candidate_id === candidate.candidate_id && receipt.screen_role === roleId
        ))),
      })),
  }
}

function atTournamentBoundary(state: ResearchCampaignStateV1): boolean {
  if (state.status === "RUNNING") return state.phase === "TOURNAMENT"
  if (state.status !== "AWAITING_HUMAN") return false
  return (state.phase === "SCREENING" && state.awaiting_reason === "AFTER_INITIAL_SCREEN")
    || (state.phase === "TOURNAMENT" && state.awaiting_reason === "TOURNAMENT_NEEDS_HUMAN")
}

function validateScreenProvenance(
  state: ResearchCampaignStateV1,
  candidates: readonly CandidateWithArtifact[],
): string | null {
  const byCandidate = new Map(candidates.map((candidate) => [candidate.candidate_id, candidate]))
  const jobs = new Map(state.job_attempts.map((job) => [job.job_id, job]))
  for (const receipt of state.screen_receipts) {
    const candidate = byCandidate.get(receipt.candidate_id)
    if (candidate === undefined || !sameArtifact(candidate.artifact, receipt.artifact)) {
      return "Tournament screen artifact hash is stale"
    }
    const job = jobs.get(receipt.job_id)
    if (job?.phase !== "COMMITTED" || job.target.kind !== "SCREEN" || job.receipt.kind !== "SCREEN"
      || job.target.screen_id !== receipt.screen_id || job.target.candidate_id !== receipt.candidate_id
      || job.phase_revision !== receipt.campaign_revision || job.child_session_id !== receipt.reviewer_session_id
      || job.raw_output_sha256 !== receipt.raw_output_sha256 || job.prompt_sha256 !== receipt.prompt_sha256
      || job.profile_sha256 !== receipt.profile_sha256 || job.reference_sha256 !== receipt.reference_sha256
      || job.resolved_model.providerID !== receipt.resolved_model.providerID
      || job.resolved_model.modelID !== receipt.resolved_model.modelID
      || job.resolved_model.variant !== receipt.resolved_model.variant) {
      return "Tournament screen provenance is stale"
    }
  }
  return null
}

function hasArtifact(candidate: CandidateDescriptor): candidate is CandidateWithArtifact {
  return candidate.artifact !== null
}

function sameArtifact(left: NonNullable<CandidateDescriptor["artifact"]>, right: ScreenReceipt["artifact"]): boolean {
  return left.child_run_id === right.child_run_id
    && left.child_state_revision === right.child_state_revision
    && left.artifact_version === right.artifact_version
    && left.media_type === right.media_type
    && left.sha256 === right.sha256
}

function invalid(message: string): Extract<TournamentAdmissionResult, { readonly ok: false }> {
  return { ok: false, message }
}
