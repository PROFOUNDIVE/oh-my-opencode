import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { stepResearchCampaign } from "../application"
import {
  removeTemporaryCampaignDirectory,
  temporaryCampaignDirectory,
} from "../application/application-test-fixture"
import { createTournamentStepDependencies } from "./tournament-operations"
import {
  campaignState,
  createScreenedCampaign,
  FakeTournamentTransport,
  keepOutput,
} from "./tournament-operation.test-support"

describe("categorical tournament operation", () => {
  let directory: string

  beforeEach(() => {
    directory = temporaryCampaignDirectory()
  })

  afterEach(() => {
    removeTemporaryCampaignDirectory(directory)
  })

  test("dispatches only after explicit checkpoint resumption and records KEEP plus DROP", async () => {
    // given
    const checkpoint = await createScreenedCampaign(directory)
    const transport = new FakeTournamentTransport(directory, [keepOutput()])

    // when
    const result = await stepResearchCampaign({
      directory,
      campaign_id: "campaign-a",
      expected_state_revision: checkpoint.state_revision,
      mode: "one_stage",
    }, createTournamentStepDependencies({
      directory,
      create_job_runtime: (callbacks) => transport.runtime(callbacks),
    }))

    // then
    expect(result).toMatchObject({ ok: true, phase: "DEEP_REFINEMENT", status: "READY" })
    expect(transport.preparedBeforeDispatch).toBe(true)
    expect(transport.requests).toHaveLength(1)
    const prompt = transport.requests[0]?.user_prompt ?? ""
    expect(prompt).toContain("entry-001")
    expect(prompt).not.toContain("direct-01")
    expect(prompt).not.toContain("candidate_id")
    const stored = await campaignState(directory)
    expect(stored.selected_candidate_id).toBe("direct-01")
    expect(stored.tournament_receipts[0]?.result).toMatchObject({
      actions: [
        { candidate_id: "direct-01", action: "KEEP" },
        { candidate_id: "contradiction-01", action: "DROP" },
      ],
    })
  })

  test("reuses persisted terminal tournament evidence after a crash", async () => {
    // given
    const checkpoint = await createScreenedCampaign(directory)
    const transport = new FakeTournamentTransport(directory, [keepOutput()], true)
    const dependencies = createTournamentStepDependencies({
      directory,
      create_job_runtime: (callbacks) => transport.runtime(callbacks),
    })

    // when
    await expect(stepResearchCampaign({
      directory, campaign_id: "campaign-a", expected_state_revision: checkpoint.state_revision, mode: "one_stage",
    }, dependencies)).rejects.toThrow("crash after persisted tournament completion")
    const crashed = await campaignState(directory)
    const resumed = await stepResearchCampaign({
      directory, campaign_id: "campaign-a", expected_state_revision: crashed.state_revision, mode: "one_stage",
    }, dependencies)

    // then
    expect(resumed).toMatchObject({ ok: true, selected_candidate_id: "direct-01" })
    expect(transport.requests).toHaveLength(1)
  })
})
