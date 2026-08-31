import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"

import { readResearchCampaignState, startResearchCampaignState } from "../storage"
import { readWorkflowState } from "../../workflow/storage"
import { buildCampaignSourceSnapshot } from "../application/build-campaign-source-snapshot"
import { createInitialCampaignState } from "../application/create-initial-campaign-state"
import {
  objectiveSnapshot,
  profileSnapshot,
  rehashProfileSnapshot,
  referenceSnapshot,
  removeTemporaryCampaignDirectory,
  temporaryCampaignDirectory,
} from "../application/application-test-fixture"
import { stepResearchCampaign } from "../application"
import type { ResearchProfileSnapshot } from "../profile-snapshot"
import { serializeCandidateChildWorkflowInput, type CandidateChildWorkflowInput } from "./candidate-child-input"
import { createCandidateDiscoveryStepDependencies } from "./candidate-discovery-operations"
import { FakeCandidateTransport } from "./candidate-discovery-test-runtime"
import { CampaignHashSchema } from "../state"

type ForbiddenBuilderKey = Extract<keyof CandidateChildWorkflowInput,
  | "candidate_id" | "sibling_candidates" | "parent_candidate_ids" | "lineage"
  | "artifact" | "screen_receipts" | "tournament_receipts" | "session_id">

const builderInputHasNoForbiddenKeys: ForbiddenBuilderKey extends never ? true : false = true

describe("candidate discovery operation", () => {
  let directory: string

  beforeEach(() => {
    directory = temporaryCampaignDirectory()
  })

  afterEach(() => {
    removeTemporaryCampaignDirectory(directory)
  })

  test("starts isolated unchanged workflows only through after_solve", async () => {
    // given
    const profile = withCandidatesPerStrategy(profileSnapshot(), 2)
    const initial = createInitialCampaignState({
      campaign_id: "campaign-a",
      parent_session_id: "ses_parent",
      source_snapshot: buildCampaignSourceSnapshot({
        objective: objectiveSnapshot(),
        profile,
        references: referenceSnapshot(),
      }),
    })
    const transport = new FakeCandidateTransport(false, directory)
    await startResearchCampaignState({ directory, state: initial })

    // when
    const result = await stepResearchCampaign({
      directory,
      campaign_id: initial.campaign_id,
      expected_state_revision: 0,
      mode: "one_stage",
    }, createCandidateDiscoveryStepDependencies({
      directory,
      create_job_runtime: (callbacks) => transport.runtime(callbacks),
    }))

    // then
    expect(result).toMatchObject({ ok: true, phase: "SCREENING", status: "READY" })
    expect(builderInputHasNoForbiddenKeys).toBe(true)
    expect(transport.preparedBeforeDispatch).toBe(true)
    expect(transport.maxActive).toBe(2)
    expect(transport.requests).toHaveLength(4)
    const serializedRequests = transport.requests.map((request) => JSON.stringify({
      system_content: request.system_content,
      user_prompt: request.user_prompt,
    }))
    const siblingIndexes = transport.requests.flatMap((request, index) => request.child_title.includes("direct-01") ? [] : [index])
    expect(siblingIndexes.every((index) => !serializedRequests[index]?.includes(FakeCandidateTransport.secret))).toBe(true)
    expect(siblingIndexes.every((index) => !serializedRequests[index]?.includes("direct-01"))).toBe(true)
    expect(siblingIndexes.every((index) => !transport.transcripts[index]?.includes(FakeCandidateTransport.secret))).toBe(true)
    expect(siblingIndexes.every((index) => !transport.transcripts[index]?.includes("direct-01"))).toBe(true)

    for (const candidateId of ["direct-01", "direct-02", "contradiction-01", "contradiction-02"]) {
      const child = await readWorkflowState(directory, `campaign-a::${candidateId}`)
      expect(child).toMatchObject({
        kind: "ok",
        state: {
          status: "AWAITING_HUMAN",
          awaiting_reason: "CHECKPOINT",
          next_stage: "REVIEW",
          amendments: [{ kind: "scope_change", scope: "all_remaining" }],
          stage_history: [{ stage: "SOLVE" }],
        },
      })
      if (child.kind === "ok") expect(child.state.stage_history).toHaveLength(1)
    }
    if (!result.ok) throw new TypeError(result.message)
    expect(result.candidate_summaries.every((candidate) => candidate.execution_status === "COMPLETED")).toBe(true)
    expect(JSON.stringify(result)).not.toContain(FakeCandidateTransport.secret)
    const campaign = await readResearchCampaignState(directory, initial.campaign_id)
    expect(JSON.stringify(campaign)).not.toContain(FakeCandidateTransport.secret)
    if (campaign.kind === "error") throw new TypeError(campaign.message)
    expect(campaign.state.candidates.every((candidate) => (
      candidate.artifact !== null
      && Object.keys(candidate.artifact).sort().join(",") === "artifact_version,child_run_id,child_state_revision,media_type,sha256"
    ))).toBe(true)
    expect(campaign.state.job_attempts.every((job) => job.phase === "COMMITTED")).toBe(true)
  })

  test("stores an input hash derived only from common snapshots and the local strategy", async () => {
    // given
    const profile = withStrategyMarkers(profileSnapshot())
    const initial = createInitialCampaignState({
      campaign_id: "campaign-a",
      parent_session_id: "ses_parent",
      source_snapshot: buildCampaignSourceSnapshot({ objective: objectiveSnapshot(), profile, references: referenceSnapshot() }),
    })
    const transport = new FakeCandidateTransport()
    await startResearchCampaignState({ directory, state: initial })

    // when
    const result = await stepResearchCampaign({
      directory,
      campaign_id: initial.campaign_id,
      expected_state_revision: 0,
      mode: "one_stage",
    }, createCandidateDiscoveryStepDependencies({ directory, create_job_runtime: (callbacks) => transport.runtime(callbacks) }))

    // then
    expect(result).toMatchObject({ ok: true })
    const inputBytes = profile.strategies.map((strategy) => serializeCandidateChildWorkflowInput({
      request_snapshot: objectiveSnapshot(),
      profile_snapshot: profile.candidate_workflow_profile,
      reference_snapshot: referenceSnapshot(),
      strategy_prompt: strategy.prompt.content,
    }))
    expect(inputBytes[1]).not.toContain("direct-01")
    expect(inputBytes[1]).not.toContain(FakeCandidateTransport.secret)
    const campaign = await readResearchCampaignState(directory, initial.campaign_id)
    if (campaign.kind === "error") throw new TypeError(campaign.message)
    expect(campaign.state.job_attempts.map((job) => job.input_sha256)).toEqual(
      inputBytes.map((input) => CampaignHashSchema.parse(sha256(input))),
    )
    const directRequest = transport.requests.find((request) => request.child_title.includes("direct-01"))
    const contradictionRequest = transport.requests.find((request) => request.child_title.includes("contradiction-01"))
    expect(directRequest?.user_prompt).toContain("STRATEGY_DIRECT_SENTINEL")
    expect(directRequest?.user_prompt).not.toContain("STRATEGY_CONTRADICTION_SENTINEL")
    expect(contradictionRequest?.user_prompt).toContain("STRATEGY_CONTRADICTION_SENTINEL")
    expect(contradictionRequest?.user_prompt).not.toContain("STRATEGY_DIRECT_SENTINEL")
  })

  test("returns a typed child failure and does not launch later strategy batches", async () => {
    // given
    const profile = withCandidatesPerStrategy(profileSnapshot(), 2)
    const initial = createInitialCampaignState({
      campaign_id: "campaign-a",
      parent_session_id: "ses_parent",
      source_snapshot: buildCampaignSourceSnapshot({ objective: objectiveSnapshot(), profile, references: referenceSnapshot() }),
    })
    const transport = new FakeCandidateTransport(true)
    await startResearchCampaignState({ directory, state: initial })

    // when
    const result = await stepResearchCampaign({
      directory,
      campaign_id: initial.campaign_id,
      expected_state_revision: 0,
      mode: "one_stage",
    }, createCandidateDiscoveryStepDependencies({ directory, create_job_runtime: (callbacks) => transport.runtime(callbacks) }))

    // then
    expect(result).toMatchObject({ ok: false, error_code: "CHILD_WORKFLOW_FAILED" })
    expect(transport.requests).toHaveLength(2)
    expect(transport.requests.every((request) => !request.child_title.includes("contradiction"))).toBe(true)
    const blocked = await readResearchCampaignState(directory, initial.campaign_id)
    expect(blocked).toMatchObject({ kind: "ok", state: { status: "BLOCKED", active_job_ids: [] } })
  })

})

function withCandidatesPerStrategy(profile: ResearchProfileSnapshot, count: number): ResearchProfileSnapshot {
  return rehashProfileSnapshot({ ...profile, candidates_per_strategy: count, max_active_candidates: 2 })
}

function withStrategyMarkers(profile: ResearchProfileSnapshot): ResearchProfileSnapshot {
  return rehashProfileSnapshot({
    ...profile,
    strategies: profile.strategies.map((strategy, index) => ({
      ...strategy,
      prompt: { ...strategy.prompt, content: index === 0 ? "STRATEGY_DIRECT_SENTINEL" : "STRATEGY_CONTRADICTION_SENTINEL" },
    })),
  })
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}
