import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { emptyDiscoveryState } from "../../openmath/research/transitions/transition-test-fixture"
import { startResearchCampaignState } from "../../openmath/research/storage"
import {
  removeTemporaryCampaignDirectory,
  temporaryCampaignDirectory,
} from "../../openmath/research/application/application-test-fixture"
import { researchToolContext } from "../openmath-research-test-support"
import { createOpenMathResearchAbortTool } from "./tools"

describe("openmath_research_abort", () => {
  let directory: string

  beforeEach(() => {
    directory = temporaryCampaignDirectory()
  })

  afterEach(() => {
    removeTemporaryCampaignDirectory(directory)
  })

  test("routes the revision-checked abort mutation", async () => {
    const state = emptyDiscoveryState()
    await startResearchCampaignState({ directory, state })
    const tool = createOpenMathResearchAbortTool({ directory })

    const result = JSON.parse(await tool.execute({
      campaign_id: state.campaign_id,
      expected_state_revision: 0,
      reason: "Stop this campaign.",
    }, researchToolContext()))

    expect(result).toMatchObject({
      ok: true,
      state_revision: 1,
      status: "ABORTED",
      next_actions: [],
    })
  })

  test("rejects omitted revisions and unknown fields", async () => {
    const tool = createOpenMathResearchAbortTool({ directory })

    const missing = JSON.parse(await tool.execute({
      campaign_id: "campaign-tool-abort",
    }, researchToolContext()))
    const unknown = JSON.parse(await tool.execute({
      campaign_id: "campaign-tool-abort",
      expected_state_revision: 0,
      actor: "forged",
    }, researchToolContext()))

    expect(missing).toMatchObject({ ok: false, error_code: "VALIDATION_ERROR" })
    expect(unknown).toMatchObject({ ok: false, error_code: "VALIDATION_ERROR" })
  })
})
