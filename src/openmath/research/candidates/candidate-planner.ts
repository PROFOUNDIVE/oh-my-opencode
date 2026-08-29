import { createHash } from "node:crypto"

import type { CampaignOperationPlanResult } from "../application"
import {
  CampaignHashSchema,
  CandidateDescriptorSchema,
  CandidateIdSchema,
  ChildRunIdSchema,
  type CandidateDescriptor,
  type ResearchCampaignStateV1,
} from "../state"
import { prepareCampaignJobAttempt } from "../scheduler"
import { serializeCandidateChildWorkflowInput } from "./candidate-child-input"
import { parseFrozenCandidateSources } from "./frozen-candidate-sources"

export function planCandidateDiscovery(state: ResearchCampaignStateV1): CampaignOperationPlanResult {
  const frozen = parseFrozenCandidateSources(state)
  if (!frozen.ok) return invalid(frozen.message)
  const profile = frozen.sources.profile
  if (profile.candidate_workflow_profile.checkpoint !== "after_solve") {
    return invalid("Candidate workflow profile must checkpoint after_solve")
  }
  const strategyIds = profile.strategies.map((strategy) => strategy.id)
  if (new Set(strategyIds).size !== strategyIds.length) return invalid("Candidate strategy IDs must be unique")

  const candidates: CandidateDescriptor[] = []
  const jobs = []
  for (const strategy of profile.strategies) {
    for (let ordinal = 1; ordinal <= profile.candidates_per_strategy; ordinal += 1) {
      const candidateId = CandidateIdSchema.safeParse(`${strategy.id}-${String(ordinal).padStart(2, "0")}`)
      if (!candidateId.success) return invalid("Candidate ID is invalid or exceeds the storage limit")
      const childRunId = ChildRunIdSchema.safeParse(`${state.campaign_id}::${candidateId.data}`)
      if (!childRunId.success) return invalid("Candidate child run ID is invalid or exceeds the storage limit")
      const descriptor = CandidateDescriptorSchema.parse({
        candidate_kind: "STRATEGY",
        candidate_id: candidateId.data,
        created_at_revision: state.state_revision + 1,
        child_run_id: childRunId.data,
        child_state_revision: null,
        artifact: null,
        attachments: [],
        strategy_id: strategy.id,
        strategy_ordinal: ordinal,
        parent_candidate_ids: [],
      })
      candidates.push(descriptor)
      jobs.push(prepareCampaignJobAttempt({
        state,
        job_id: `job-candidate-${candidateId.data}`,
        target: { kind: "CANDIDATE", candidate_id: candidateId.data },
        role: profile.candidate_workflow_profile.solve.agent,
        resolved_model: profile.candidate_workflow_profile.solve.model,
        profile_sha256: state.source_snapshot.profile.sha256,
        prompt_sha256: strategy.prompt.content_hash,
        reference_sha256: state.source_snapshot.references.sha256,
        input_sha256: CampaignHashSchema.parse(sha256(serializeCandidateChildWorkflowInput({
          request_snapshot: frozen.sources.objective,
          profile_snapshot: profile.candidate_workflow_profile,
          reference_snapshot: frozen.sources.references,
          strategy_prompt: strategy.prompt.content,
        }))),
      }))
    }
  }
  if (new Set(candidates.map((candidate) => candidate.child_run_id)).size !== candidates.length) {
    return invalid("Candidate child run IDs must be unique")
  }
  return { ok: true, plan: { candidates, job_attempts: jobs } }
}

function invalid(message: string): Extract<CampaignOperationPlanResult, { readonly ok: false }> {
  return { ok: false, error_code: "VALIDATION_ERROR", message }
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}
