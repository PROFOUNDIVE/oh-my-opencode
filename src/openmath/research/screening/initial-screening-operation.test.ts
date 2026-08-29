import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { stepResearchCampaign } from "../application"
import { buildCampaignSourceSnapshot } from "../application/build-campaign-source-snapshot"
import { createInitialCampaignState } from "../application/create-initial-campaign-state"
import {
  objectiveSnapshot,
  profileSnapshot,
  referenceSnapshot,
  removeTemporaryCampaignDirectory,
  temporaryCampaignDirectory,
} from "../application/application-test-fixture"
import { createCandidateDiscoveryStepDependencies } from "../candidates/candidate-discovery-operations"
import { FakeCandidateTransport } from "../candidates/candidate-discovery-test-runtime"
import { readResearchCampaignState, startResearchCampaignState } from "../storage"
import { createInitialScreeningStepDependencies } from "./screening-operations"
import { BlindScreenInputSchema } from "./screen-input"
import { FakeScreeningTransport } from "./screening-test-runtime"

describe("initial screening operation", () => {
  let directory: string

  beforeEach(() => {
    directory = temporaryCampaignDirectory()
  })

  afterEach(() => {
    removeTemporaryCampaignDirectory(directory)
  })

  test("runs the full blind matrix concurrently and publishes one durable checkpoint", async () => {
    // given
    const ready = await discoverCandidates(directory)
    const transport = new FakeScreeningTransport()

    // when
    const result = await stepResearchCampaign({
      directory,
      campaign_id: "campaign-a",
      expected_state_revision: ready.state_revision,
      mode: "one_stage",
    }, createInitialScreeningStepDependencies({
      directory,
      create_job_runtime: (callbacks) => transport.runtime(callbacks),
    }))

    // then
    expect(result).toMatchObject({ ok: true, phase: "SCREENING", status: "AWAITING_HUMAN" })
    expect(transport.requests).toHaveLength(2)
    expect(transport.maxActive).toBe(2)
    for (const request of transport.requests) {
      expect(request.system_content).toBeUndefined()
      const parsed: unknown = JSON.parse(request.user_prompt)
      const payload = BlindScreenInputSchema.parse(parsed)
      expect(Object.keys(payload).sort()).toEqual([
        "objective", "reference_contents", "screening_instructions", "target_artifact",
      ])
      expect(request.user_prompt).not.toContain("candidate_id")
      expect(request.user_prompt).not.toContain("screen_receipts")
    }
    const stored = await campaignState(directory)
    expect(stored.awaiting_reason).toBe("AFTER_INITIAL_SCREEN")
    expect(stored.screen_receipts).toHaveLength(2)
    expect(stored.job_attempts.filter((job) => job.target.kind === "SCREEN").every((job) => (
      job.phase === "COMMITTED" && job.receipt.kind === "SCREEN" && job.receipt.normalized_output !== undefined
    ))).toBe(true)
  })

  test("blocks malformed output instead of publishing the screening checkpoint", async () => {
    // given
    const ready = await discoverCandidates(directory)
    const transport = new FakeScreeningTransport(true)

    // when
    const result = await stepResearchCampaign({
      directory,
      campaign_id: "campaign-a",
      expected_state_revision: ready.state_revision,
      mode: "one_stage",
    }, createInitialScreeningStepDependencies({
      directory,
      create_job_runtime: (callbacks) => transport.runtime(callbacks),
    }))

    // then
    expect(result).toMatchObject({ ok: false, error_code: "CHILD_WORKFLOW_FAILED" })
    const stored = await campaignState(directory)
    expect(stored).toMatchObject({ status: "BLOCKED", awaiting_reason: null, screen_receipts: [] })
  })

  test("reuses persisted terminal evidence after a crash without duplicate dispatch", async () => {
    // given
    const ready = await discoverCandidates(directory)
    const transport = new FakeScreeningTransport(false, true)
    const dependencies = createInitialScreeningStepDependencies({
      directory,
      create_job_runtime: (callbacks) => transport.runtime(callbacks),
    })

    // when
    await expect(stepResearchCampaign({
      directory,
      campaign_id: "campaign-a",
      expected_state_revision: ready.state_revision,
      mode: "one_stage",
    }, dependencies)).rejects.toThrow("crash after persisted screen completion")
    const crashed = await campaignState(directory)
    const resumed = await stepResearchCampaign({
      directory,
      campaign_id: "campaign-a",
      expected_state_revision: crashed.state_revision,
      mode: "one_stage",
    }, dependencies)

    // then
    expect(resumed).toMatchObject({ ok: true, status: "AWAITING_HUMAN" })
    expect(transport.requests).toHaveLength(2)
    expect((await campaignState(directory)).screen_receipts).toHaveLength(2)
  })
})

async function discoverCandidates(directory: string) {
  const initial = createInitialCampaignState({
    campaign_id: "campaign-a",
    parent_session_id: "ses_parent",
    source_snapshot: buildCampaignSourceSnapshot({
      objective: objectiveSnapshot(),
      profile: profileSnapshot(),
      references: referenceSnapshot(),
    }),
  })
  await startResearchCampaignState({ directory, state: initial })
  const transport = new FakeCandidateTransport(false, directory)
  const result = await stepResearchCampaign({
    directory,
    campaign_id: "campaign-a",
    expected_state_revision: 0,
    mode: "one_stage",
  }, createCandidateDiscoveryStepDependencies({
    directory,
    create_job_runtime: (callbacks) => transport.runtime(callbacks),
  }))
  if (!result.ok) throw new Error(result.message)
  return campaignState(directory)
}

async function campaignState(directory: string) {
  const result = await readResearchCampaignState(directory, "campaign-a")
  if (result.kind === "error") throw new Error(result.message)
  return result.state
}
