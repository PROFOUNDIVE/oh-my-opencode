import { expect, test } from "bun:test"

import { buildCampaignSourceSnapshot } from "../application/build-campaign-source-snapshot"
import { createInitialCampaignState } from "../application/create-initial-campaign-state"
import { HASH, objectiveSnapshot, profileSnapshot, referenceSnapshot } from "../application/application-test-fixture"
import { ResearchCampaignStateV1Schema } from "../state"
import { planInitialScreening } from "./screening-planner"

test("plans the complete configured reviewer by candidate matrix in stable order", () => {
  // given
  const profile = profileSnapshot()
  const initial = createInitialCampaignState({
    campaign_id: "campaign-a",
    parent_session_id: "ses_parent1",
    source_snapshot: buildCampaignSourceSnapshot({
      objective: objectiveSnapshot(),
      profile,
      references: referenceSnapshot(),
    }),
  })
  const state = ResearchCampaignStateV1Schema.parse({
    ...initial,
    state_revision: 2,
    phase: "SCREENING",
    candidates: ["direct-01", "contradiction-01"].map((candidateId) => ({
      candidate_kind: "STRATEGY",
      candidate_id: candidateId,
      created_at_revision: 1,
      child_run_id: `campaign-a::${candidateId}`,
      child_state_revision: 2,
      artifact: {
        child_run_id: `campaign-a::${candidateId}`,
        child_state_revision: 2,
        artifact_version: 1,
        media_type: "text/markdown",
        sha256: HASH,
      },
      attachments: [],
      strategy_id: candidateId.split("-")[0],
      strategy_ordinal: 1,
      parent_candidate_ids: [],
    })),
  })

  // when
  const result = planInitialScreening(state)

  // then
  expect(result).toMatchObject({ ok: true })
  if (!result.ok) throw new Error(result.message)
  expect(result.plan.candidates).toEqual([])
  expect(result.plan.job_attempts.map((job) => job.target)).toEqual([
    { kind: "SCREEN", screen_id: "screen-direct-01-screen", candidate_id: "direct-01" },
    { kind: "SCREEN", screen_id: "screen-contradiction-01-screen", candidate_id: "contradiction-01" },
  ])
  expect(result.plan.job_attempts.every((job) => job.phase === "PREPARED" && job.role === "screen-agent")).toBe(true)
})
