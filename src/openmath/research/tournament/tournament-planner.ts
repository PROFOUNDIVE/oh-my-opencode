import { sha256 } from "../../workflow/stage-runner/sha256"
import type { CampaignOperationPlanResult } from "../application"
import { parseFrozenCandidateSources } from "../candidates/frozen-candidate-sources"
import {
  CampaignHashSchema,
  TournamentIdSchema,
  type ResearchCampaignStateV1,
  type ScreenReceipt,
} from "../state"
import { prepareCampaignJobAttempt } from "../scheduler"
import { admitTournamentCandidates } from "./tournament-admission"

export function planTournament(state: ResearchCampaignStateV1): CampaignOperationPlanResult {
  const admission = admitTournamentCandidates(state)
  if (!admission.ok) return invalid(admission.message)
  const frozen = parseFrozenCandidateSources(state)
  if (!frozen.ok) return invalid(frozen.message)
  const attemptNumber = state.job_attempts.filter((job) => job.target.kind === "TOURNAMENT").length + 1
  const tournamentId = TournamentIdSchema.safeParse(`tournament-${String(attemptNumber).padStart(2, "0")}`)
  if (!tournamentId.success) return invalid("Tournament ID is invalid or exceeds the storage limit")
  const role = frozen.sources.profile.tournament_role
  const inputHash = CampaignHashSchema.parse(sha256(JSON.stringify(admission.candidates.map(({ candidate, screens }) => ({
    candidate_id: candidate.candidate_id,
    artifact: candidate.artifact,
    screens: screens.map(normalizedScreen),
  })))))
  return {
    ok: true,
    plan: {
      candidates: [],
      job_attempts: [prepareCampaignJobAttempt({
        state,
        job_id: `job-${tournamentId.data}`,
        target: { kind: "TOURNAMENT", tournament_id: tournamentId.data },
        role: role.agent,
        resolved_model: role.model,
        profile_sha256: state.source_snapshot.profile.sha256,
        prompt_sha256: role.prompt.content_hash,
        reference_sha256: state.source_snapshot.references.sha256,
        input_sha256: inputHash,
      })],
    },
  }
}

function normalizedScreen(screen: ScreenReceipt) {
  return {
    verdict: screen.verdict,
    blocking_issues: screen.blocking_issues,
    unresolved_obligations: screen.unresolved_obligations,
    assumptions: screen.assumptions,
    novel_elements: screen.novel_elements,
  }
}

function invalid(message: string): Extract<CampaignOperationPlanResult, { readonly ok: false }> {
  return { ok: false, error_code: "VALIDATION_ERROR", message }
}
