import { createHash } from "node:crypto"

import type { CampaignOperationPlanResult } from "../application"
import { parseFrozenCandidateSources } from "../candidates/frozen-candidate-sources"
import { CampaignHashSchema, ScreenIdSchema, type ResearchCampaignStateV1 } from "../state"
import { prepareCampaignJobAttempt } from "../scheduler"

export function planInitialScreening(state: ResearchCampaignStateV1): CampaignOperationPlanResult {
  const frozen = parseFrozenCandidateSources(state)
  if (!frozen.ok) return invalid(frozen.message)
  const candidates = state.candidates.filter((candidate) => candidate.artifact !== null)
  if (candidates.length === 0) return invalid("Initial screening requires candidate artifacts")
  const jobs = []
  for (const candidate of candidates) {
    for (const role of frozen.sources.profile.screening_roles) {
      const screenId = ScreenIdSchema.safeParse(`screen-${candidate.candidate_id}-${role.id}`)
      if (!screenId.success) return invalid("Screen ID is invalid or exceeds the storage limit")
      jobs.push(prepareCampaignJobAttempt({
        state,
        job_id: `job-${screenId.data}`,
        target: { kind: "SCREEN", screen_id: screenId.data, candidate_id: candidate.candidate_id },
        role: role.agent,
        resolved_model: role.model,
        profile_sha256: state.source_snapshot.profile.sha256,
        prompt_sha256: role.prompt.content_hash,
        reference_sha256: state.source_snapshot.references.sha256,
        input_sha256: CampaignHashSchema.parse(sha256(JSON.stringify({
          objective: frozen.sources.objective,
          references: frozen.sources.references,
          artifact: candidate.artifact,
          screening_instructions: role.prompt.content,
        }))),
      }))
    }
  }
  return { ok: true, plan: { candidates: [], job_attempts: jobs } }
}

function invalid(message: string): Extract<CampaignOperationPlanResult, { readonly ok: false }> {
  return { ok: false, error_code: "VALIDATION_ERROR", message }
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}
