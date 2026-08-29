import { describe, expect, test } from "bun:test"

import { buildCampaignSourceSnapshot } from "../application/build-campaign-source-snapshot"
import { createInitialCampaignState } from "../application/create-initial-campaign-state"
import { objectiveSnapshot, profileSnapshot, referenceSnapshot } from "../application/application-test-fixture"
import type { ResearchProfileSnapshot } from "../profile-snapshot"
import { planCandidateDiscovery } from "./candidate-planner"

describe("candidate discovery planner", () => {
  test("plans one ordered candidate and PREPARED job per strategy ordinal", () => {
    // given
    const profile = withCandidatesPerStrategy(profileSnapshot(), 2)
    const state = campaignState(profile)

    // when
    const result = planCandidateDiscovery(state)

    // then
    expect(result).toMatchObject({ ok: true })
    if (!result.ok) throw new TypeError(result.message)
    expect(result.plan.candidates.map((candidate) => ({
      id: candidate.candidate_id,
      run: candidate.child_run_id,
      ordinal: candidate.candidate_kind === "STRATEGY" ? candidate.strategy_ordinal : 0,
      parents: candidate.parent_candidate_ids,
    }))).toEqual([
      { id: "direct-01", run: "campaign-a::direct-01", ordinal: 1, parents: [] },
      { id: "direct-02", run: "campaign-a::direct-02", ordinal: 2, parents: [] },
      { id: "contradiction-01", run: "campaign-a::contradiction-01", ordinal: 1, parents: [] },
      { id: "contradiction-02", run: "campaign-a::contradiction-02", ordinal: 2, parents: [] },
    ])
    expect(result.plan.job_attempts.map((job) => ({
      phase: job.phase,
      job: job.job_id,
      target: job.target,
      prepared: job.prepared_at_revision,
    }))).toEqual([
      { phase: "PREPARED", job: "job-candidate-direct-01", target: { kind: "CANDIDATE", candidate_id: "direct-01" }, prepared: 1 },
      { phase: "PREPARED", job: "job-candidate-direct-02", target: { kind: "CANDIDATE", candidate_id: "direct-02" }, prepared: 1 },
      { phase: "PREPARED", job: "job-candidate-contradiction-01", target: { kind: "CANDIDATE", candidate_id: "contradiction-01" }, prepared: 1 },
      { phase: "PREPARED", job: "job-candidate-contradiction-02", target: { kind: "CANDIDATE", candidate_id: "contradiction-02" }, prepared: 1 },
    ])
  })

  test("rejects duplicate strategy IDs before admission", () => {
    // given
    const initial = profileSnapshot()
    const duplicate: ResearchProfileSnapshot = {
      ...initial,
      strategies: [initial.strategies[0] ?? missingStrategy(), initial.strategies[0] ?? missingStrategy()],
    }

    // when
    const result = planCandidateDiscovery(campaignState(duplicate))

    // then
    expect(result).toMatchObject({ ok: false, error_code: "VALIDATION_ERROR" })
  })

  test("rejects candidate ID overflow instead of creating colliding child runs", () => {
    // given
    const initial = profileSnapshot()
    const oversized: ResearchProfileSnapshot = {
      ...initial,
      strategies: [
        { ...(initial.strategies[0] ?? missingStrategy()), id: "a".repeat(128) },
        initial.strategies[1] ?? missingStrategy(),
      ],
    }

    // when
    const result = planCandidateDiscovery(campaignState(oversized))

    // then
    expect(result).toMatchObject({ ok: false, error_code: "VALIDATION_ERROR" })
  })

  test("rejects a frozen candidate profile without the after_solve checkpoint", () => {
    // given
    const initial = profileSnapshot()
    const incompatible: ResearchProfileSnapshot = {
      ...initial,
      candidate_workflow_profile: { ...initial.candidate_workflow_profile, checkpoint: "none" },
    }

    // when
    const result = planCandidateDiscovery(campaignState(incompatible))

    // then
    expect(result).toMatchObject({ ok: false, error_code: "VALIDATION_ERROR" })
  })
})

function campaignState(profile: ResearchProfileSnapshot) {
  const references = referenceSnapshot()
  return createInitialCampaignState({
    campaign_id: "campaign-a",
    parent_session_id: "ses_parent",
    source_snapshot: buildCampaignSourceSnapshot({ objective: objectiveSnapshot(), profile, references }),
  })
}

function withCandidatesPerStrategy(profile: ResearchProfileSnapshot, count: number): ResearchProfileSnapshot {
  return { ...profile, candidates_per_strategy: count, max_active_candidates: count }
}

function missingStrategy(): ResearchProfileSnapshot["strategies"][number] {
  throw new TypeError("Research profile fixture is missing a strategy")
}
