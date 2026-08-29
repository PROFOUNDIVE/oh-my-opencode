import type { AggregateInvariantInput } from "./aggregate-invariant-input"
import type { CandidateArtifactReference } from "./candidates"

export function isCommittedRefinementAncestor(
  state: AggregateInvariantInput,
  candidate: AggregateInvariantInput["candidates"][number],
  expectedArtifact: CandidateArtifactReference,
): boolean {
  if (state.selected_candidate_id !== candidate.candidate_id || candidate.artifact === null) return false
  const tournamentRevision = state.tournament_receipts[state.tournament_receipts.length - 1]?.campaign_revision
  if (tournamentRevision === undefined) return false
  const refinements = state.job_attempts.filter((attempt) => (
    attempt.phase === "COMMITTED" && attempt.prepared_at_revision > tournamentRevision
    && attempt.target.kind === "CANDIDATE" && attempt.target.candidate_id === candidate.candidate_id
    && attempt.receipt.kind === "CANDIDATE_ARTIFACT"
  ))
  let current = candidate.artifact
  const consumed = new Set<string>()
  for (let depth = 0; depth <= refinements.length; depth += 1) {
    if (sameArtifact(current, expectedArtifact)) return consumed.size === refinements.length
    const attempt = latestRefinementFor(refinements, current, consumed)
    if (attempt === null || attempt.receipt.kind !== "CANDIDATE_ARTIFACT"
      || attempt.receipt.predecessor_artifact === undefined) return false
    consumed.add(attempt.job_id)
    current = attempt.receipt.predecessor_artifact
  }
  return false
}

export function hasCompleteMergeRefinementLineage(
  state: AggregateInvariantInput,
  candidate: AggregateInvariantInput["candidates"][number],
): boolean {
  if (candidate.candidate_kind !== "MERGE_IDEA" || candidate.artifact === null) return false
  const tournamentRevision = state.tournament_receipts[state.tournament_receipts.length - 1]?.campaign_revision
  if (tournamentRevision === undefined) return false
  const refinements = committedRefinements(state, candidate.candidate_id, tournamentRevision)
  const consumed = new Set<string>()
  let current = candidate.artifact
  for (let depth = 0; depth < refinements.length; depth += 1) {
    const attempt = latestRefinementFor(refinements, current, consumed)
    if (attempt === null || attempt.receipt.kind !== "CANDIDATE_ARTIFACT") return false
    consumed.add(attempt.job_id)
    if (attempt.receipt.predecessor_artifact === undefined) return consumed.size === refinements.length
    current = attempt.receipt.predecessor_artifact
  }
  return false
}

function committedRefinements(state: AggregateInvariantInput, candidateId: string, tournamentRevision: number) {
  return state.job_attempts.filter((attempt) => (
    attempt.phase === "COMMITTED" && attempt.prepared_at_revision > tournamentRevision
    && attempt.target.kind === "CANDIDATE" && attempt.target.candidate_id === candidateId
    && attempt.receipt.kind === "CANDIDATE_ARTIFACT"
  ))
}

function latestRefinementFor(
  refinements: readonly AggregateInvariantInput["job_attempts"][number][],
  artifact: CandidateArtifactReference,
  consumed: ReadonlySet<string>,
) {
  for (let index = refinements.length - 1; index >= 0; index -= 1) {
    const attempt = refinements[index]
    if (attempt?.phase === "COMMITTED" && !consumed.has(attempt.job_id)
      && attempt.receipt.kind === "CANDIDATE_ARTIFACT" && attempt.receipt.refined_artifact !== undefined
      && sameArtifact(attempt.receipt.refined_artifact, artifact)) {
      return attempt
    }
  }
  return null
}

function sameArtifact(left: CandidateArtifactReference, right: CandidateArtifactReference): boolean {
  return left.child_run_id === right.child_run_id
    && left.child_state_revision === right.child_state_revision
    && left.artifact_version === right.artifact_version
    && left.media_type === right.media_type
    && left.sha256 === right.sha256
}
