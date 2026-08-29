import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { emptyDiscoveryState } from "../../openmath/research/transitions/transition-test-fixture"
import { startResearchCampaignState } from "../../openmath/research/storage"
import {
  removeTemporaryCampaignDirectory,
  temporaryCampaignDirectory,
} from "../../openmath/research/application/application-test-fixture"
import { researchToolContext } from "../openmath-research-test-support"
import { createOpenMathResearchAmendTool } from "./tools"

describe("openmath_research_amend", () => {
  let directory: string

  beforeEach(() => {
    directory = temporaryCampaignDirectory()
  })

  afterEach(() => {
    removeTemporaryCampaignDirectory(directory)
  })

  test("routes strict add and retract amendments with exact revisions", async () => {
    const state = emptyDiscoveryState()
    await startResearchCampaignState({ directory, state })
    const tool = createOpenMathResearchAmendTool({ directory })

    const added = JSON.parse(await tool.execute({
      campaign_id: state.campaign_id,
      expected_state_revision: 0,
      operation: "add",
      kind: "required_check",
      scope: "all_candidates",
      content: "Check the edge case.",
    }, researchToolContext()))
    const retracted = JSON.parse(await tool.execute({
      campaign_id: state.campaign_id,
      expected_state_revision: 1,
      operation: "retract",
      amendment_id: "amendment-1",
    }, researchToolContext()))

    expect(added).toMatchObject({ ok: true, state_revision: 1 })
    expect(retracted).toMatchObject({ ok: true, state_revision: 2 })
  })

  test("rejects stale, malformed branch, and unknown fields", async () => {
    const state = emptyDiscoveryState()
    await startResearchCampaignState({ directory, state })
    const tool = createOpenMathResearchAmendTool({ directory })

    const results = await Promise.all([
      tool.execute({
        campaign_id: state.campaign_id,
        expected_state_revision: 3,
        operation: "add",
        kind: "question",
        scope: "candidate:direct-01",
        content: "Why?",
      }, researchToolContext()),
      tool.execute({
        campaign_id: state.campaign_id,
        expected_state_revision: 0,
        operation: "retract",
        amendment_id: "amendment-1",
        content: "forbidden",
      }, researchToolContext()),
      tool.execute({
        campaign_id: state.campaign_id,
        expected_state_revision: 0,
        operation: "add",
        kind: "question",
        scope: "future_phase",
        content: "Why?",
      }, researchToolContext()),
    ])

    expect(results.map((value) => JSON.parse(value).error_code)).toEqual([
      "STALE_STATE_REVISION",
      "VALIDATION_ERROR",
      "VALIDATION_ERROR",
    ])
  })
})
