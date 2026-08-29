import { sha256 } from "../../workflow/stage-runner/sha256"
import type { CampaignOperationPlanResult } from "../application"
import { parseFrozenCandidateSources } from "../candidates/frozen-candidate-sources"
import { CampaignHashSchema, type ResearchCampaignStateV1 } from "../state"
import { prepareCampaignJobAttempt } from "../scheduler"

export function planSelectedRefinement(state: ResearchCampaignStateV1): CampaignOperationPlanResult {
  if (state.phase !== "DEEP_REFINEMENT" || state.selected_candidate_id === null) {
    return invalid("Deep refinement requires one persisted tournament selection")
  }
  const selected = state.candidates.filter((candidate) => candidate.candidate_id === state.selected_candidate_id)
  const candidate = selected[0]
  if (selected.length !== 1 || candidate === undefined || candidate.child_state_revision === null) {
    return invalid("Persisted tournament selection must bind exactly one child workflow")
  }
  const frozen = parseFrozenCandidateSources(state)
  if (!frozen.ok) return invalid(frozen.message)
  const role = candidate.candidate_kind === "MERGE_IDEA" && candidate.artifact === null
    ? frozen.sources.profile.candidate_workflow_profile.solve
    : frozen.sources.profile.candidate_workflow_profile.review
  const attempt = state.job_attempts.filter((job) => (
    job.target.kind === "CANDIDATE" && job.target.candidate_id === candidate.candidate_id
  )).length + 1
  return {
    ok: true,
    plan: {
      candidates: [],
      job_attempts: [prepareCampaignJobAttempt({
        state,
        job_id: `job-refinement-${candidate.candidate_id}-${String(attempt).padStart(2, "0")}`,
        target: { kind: "CANDIDATE", candidate_id: candidate.candidate_id },
        role: role.agent,
        resolved_model: role.model,
        profile_sha256: state.source_snapshot.profile.sha256,
        prompt_sha256: CampaignHashSchema.parse(sha256(JSON.stringify(role.prompt))),
        reference_sha256: state.source_snapshot.references.sha256,
        input_sha256: CampaignHashSchema.parse(sha256(JSON.stringify(candidate))),
      })],
    },
  }
}

function invalid(message: string): Extract<CampaignOperationPlanResult, { readonly ok: false }> {
  return { ok: false, error_code: "VALIDATION_ERROR", message }
}
