import { z } from "zod"

import { aggregateScreening } from "../screening/screening-aggregation"
import type { AggregateInvariantInput } from "./aggregate-invariant-input"
import type { CandidateArtifactReference } from "./candidates"
import { hasCompleteMergeRefinementLineage, isCommittedRefinementAncestor } from "./committed-refinement"
import { validateTournamentSelection } from "./selection-invariants"

const FrozenTournamentProfileSchema = z.object({ survivor_limit: z.number().int().positive(), screening_roles: z.array(z.object({ id: z.string().min(1) }).loose()).min(1) }).loose()

export function validateCampaignIdentityInvariants(state: AggregateInvariantInput, context: z.RefinementCtx): void {
  const candidates = validateCandidates(state, context)
  const jobs = validateJobs(state, candidates, context)
  const screens = validateScreens(state, candidates, jobs, context)
  validateMergeRefinement(state, candidates, context)
  validateTournaments(state, candidates, jobs, screens, context)
  validateAmendmentScopes(state, candidates, context)
  validateTournamentSelection(state, context)
}

function validateMergeRefinement(
  state: AggregateInvariantInput,
  candidates: ReadonlyMap<string, AggregateInvariantInput["candidates"][number]>,
  context: z.RefinementCtx,
): void {
  const selected = state.selected_candidate_id === null ? undefined : candidates.get(state.selected_candidate_id)
  if (selected?.candidate_kind !== "MERGE_IDEA" || selected.artifact === null) return
  if (!hasCompleteMergeRefinementLineage(state, selected)) {
    const index = state.candidates.findIndex((candidate) => candidate.candidate_id === selected.candidate_id)
    addIssue(context, ["candidates", index, "artifact"], "Merge artifact must have a complete committed refinement lineage")
  }
}

function validateCandidates(state: AggregateInvariantInput, context: z.RefinementCtx): Map<string, AggregateInvariantInput["candidates"][number]> {
  const candidates = new Map<string, AggregateInvariantInput["candidates"][number]>()
  const childRuns = new Set<string>()
  for (const [index, candidate] of state.candidates.entries()) {
    if (candidates.has(candidate.candidate_id)) addIssue(context, ["candidates", index, "candidate_id"], "Candidate IDs must be unique")
    if (childRuns.has(candidate.child_run_id)) addIssue(context, ["candidates", index, "child_run_id"], "Candidate child runs must be unique")
    if (candidate.child_run_id !== `${state.campaign_id}::${candidate.candidate_id}`) addIssue(context, ["candidates", index, "child_run_id"], "Candidate child run must match campaign and candidate identity")
    for (const parent of candidate.parent_candidate_ids) {
      if (!candidates.has(parent)) addIssue(context, ["candidates", index, "parent_candidate_ids"], "Candidate parents must precede their child")
    }
    candidates.set(candidate.candidate_id, candidate)
    childRuns.add(candidate.child_run_id)
  }
  return candidates
}

function validateJobs(
  state: AggregateInvariantInput,
  candidates: ReadonlyMap<string, AggregateInvariantInput["candidates"][number]>,
  context: z.RefinementCtx,
): Map<string, AggregateInvariantInput["job_attempts"][number]> {
  const jobs = new Map<string, AggregateInvariantInput["job_attempts"][number]>()
  for (const [index, job] of state.job_attempts.entries()) {
    if (jobs.has(job.job_id)) addIssue(context, ["job_attempts", index, "job_id"], "Job IDs must be unique")
    switch (job.target.kind) {
      case "CANDIDATE":
      case "SCREEN":
        if (!candidates.has(job.target.candidate_id)) addIssue(context, ["job_attempts", index, "target", "candidate_id"], "Job candidate must exist")
        break
      case "TOURNAMENT":
        break
      default:
        assertNever(job.target)
    }
    jobs.set(job.job_id, job)
  }
  for (const [index, activeJobId] of state.active_job_ids.entries()) {
    if (!jobs.has(activeJobId)) addIssue(context, ["active_job_ids", index], "Active job must exist")
  }
  return jobs
}

function validateScreens(
  state: AggregateInvariantInput,
  candidates: ReadonlyMap<string, AggregateInvariantInput["candidates"][number]>,
  jobs: ReadonlyMap<string, AggregateInvariantInput["job_attempts"][number]>,
  context: z.RefinementCtx,
): Map<string, AggregateInvariantInput["screen_receipts"][number]> {
  const screens = new Map<string, AggregateInvariantInput["screen_receipts"][number]>()
  for (const [index, screen] of state.screen_receipts.entries()) {
    if (screens.has(screen.screen_id)) addIssue(context, ["screen_receipts", index, "screen_id"], "Screen IDs must be unique")
    const candidate = candidates.get(screen.candidate_id)
    if (candidate?.artifact === null || candidate?.artifact === undefined
      || !sameArtifact(candidate.artifact, screen.artifact)
        && !isCommittedRefinementAncestor(state, candidate, screen.artifact)) {
      addIssue(context, ["screen_receipts", index, "artifact"], "Screen artifact must match candidate artifact or its committed refinement predecessor")
    }
    const job = jobs.get(screen.job_id)
    if (job?.phase !== "COMMITTED" || job.target.kind !== "SCREEN" || job.target.screen_id !== screen.screen_id || job.target.candidate_id !== screen.candidate_id || job.phase_revision !== screen.campaign_revision || job.raw_output_sha256 !== screen.raw_output_sha256) addIssue(context, ["screen_receipts", index, "job_id"], "Screen receipt must match its committed job")
    screens.set(screen.screen_id, screen)
  }
  return screens
}

function validateTournaments(
  state: AggregateInvariantInput,
  candidates: ReadonlyMap<string, AggregateInvariantInput["candidates"][number]>,
  jobs: ReadonlyMap<string, AggregateInvariantInput["job_attempts"][number]>,
  screens: ReadonlyMap<string, AggregateInvariantInput["screen_receipts"][number]>,
  context: z.RefinementCtx,
): void {
  const tournamentIds = new Set<string>()
  for (const [index, tournament] of state.tournament_receipts.entries()) {
    if (tournamentIds.has(tournament.tournament_id)) addIssue(context, ["tournament_receipts", index, "tournament_id"], "Tournament IDs must be unique")
    const job = jobs.get(tournament.job_id)
    if (job?.phase !== "COMMITTED" || job.target.kind !== "TOURNAMENT" || job.receipt.kind !== "TOURNAMENT"
      || job.receipt.result === undefined || job.target.tournament_id !== tournament.tournament_id
      || job.phase_revision !== tournament.campaign_revision || job.raw_output_sha256 !== tournament.raw_output_sha256
      || JSON.stringify(job.receipt.result) !== JSON.stringify(tournament.result)) {
      addIssue(context, ["tournament_receipts", index, "job_id"], "Tournament receipt must match its committed job")
    }
    const screenedCandidates = new Set<string>()
    for (const screenId of tournament.screen_ids) {
      const screen = screens.get(screenId)
      if (screen === undefined) addIssue(context, ["tournament_receipts", index, "screen_ids"], "Tournament screen must exist")
      else screenedCandidates.add(screen.candidate_id)
    }
    switch (tournament.result.kind) {
      case "DECIDED":
        for (const action of tournament.result.actions) {
          if (!candidates.has(action.candidate_id) || !screenedCandidates.has(action.candidate_id)) addIssue(context, ["tournament_receipts", index, "result", "actions"], "Tournament candidate must have an included screen")
        }
        validateTournamentCoverage(state, tournament, context, index)
        break
      case "NEEDS_HUMAN":
        validateTournamentCoverage(state, tournament, context, index)
        break
      default:
        assertNever(tournament.result)
    }
    tournamentIds.add(tournament.tournament_id)
  }
}

function validateTournamentCoverage(
  state: AggregateInvariantInput,
  tournament: AggregateInvariantInput["tournament_receipts"][number],
  context: z.RefinementCtx,
  index: number,
): void {
  const profile = parseFrozenTournamentProfile(state.source_snapshot.profile.serialized_bytes)
  if (profile === null) {
    addIssue(context, ["source_snapshot", "profile"], "Frozen tournament profile is invalid")
    return
  }
  const survivors = aggregateScreening(
    state.candidates.filter((candidate) => candidate.artifact !== null),
    state.screen_receipts,
    profile.survivor_limit,
  ).survivor_ids
  const expectedScreenIds = survivors.flatMap((candidateId) => profile.screening_roles.map((role) => (
    state.screen_receipts.find((screen) => screen.candidate_id === candidateId && screen.screen_role === role.id)?.screen_id
  )))
  if (expectedScreenIds.some((screenId) => screenId === undefined)
    || !sameOrder(tournament.screen_ids, expectedScreenIds)) {
    addIssue(context, ["tournament_receipts", index, "screen_ids"], "Tournament screens must cover the complete fixed survivor set")
  }
  switch (tournament.result.kind) {
    case "DECIDED":
      if (!sameOrder(tournament.result.actions.map((action) => action.candidate_id), survivors)) {
        addIssue(context, ["tournament_receipts", index, "result", "actions"], "Tournament actions must cover each fixed survivor exactly once")
      }
      return
    case "NEEDS_HUMAN":
      return
    default:
      return assertNever(tournament.result)
  }
}

function parseFrozenTournamentProfile(serialized: string): z.infer<typeof FrozenTournamentProfileSchema> | null {
  try {
    const profile = FrozenTournamentProfileSchema.safeParse(JSON.parse(serialized))
    return profile.success ? profile.data : null
  } catch (error) {
    if (error instanceof SyntaxError) return null
    throw error
  }
}

function sameOrder<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function validateAmendmentScopes(state: AggregateInvariantInput, candidates: ReadonlyMap<string, unknown>, context: z.RefinementCtx): void {
  for (const [index, event] of state.amendments.entries()) {
    switch (event.event_type) {
      case "ADDED":
        if (event.scope.startsWith("candidate:") && !candidates.has(event.scope.slice("candidate:".length))) addIssue(context, ["amendments", index, "scope"], "Amendment candidate must exist")
        break
      case "CONSUMED":
      case "RETRACTED":
        break
      default:
        assertNever(event)
    }
  }
}

function sameArtifact(left: CandidateArtifactReference, right: CandidateArtifactReference): boolean {
  return left.child_run_id === right.child_run_id && left.child_state_revision === right.child_state_revision && left.artifact_version === right.artifact_version && left.media_type === right.media_type && left.sha256 === right.sha256
}

function addIssue(context: z.RefinementCtx, path: readonly (string | number)[], message: string): void {
  context.addIssue({ code: "custom", path: [...path], message })
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected campaign reference variant: ${String(value)}`)
}
