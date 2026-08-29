import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import {
  removeTemporaryCampaignDirectory,
  temporaryCampaignDirectory,
} from "../../openmath/research/application/application-test-fixture"
import { researchToolConfig, researchToolContext } from "../openmath-research-test-support"
import { createOpenMathResearchStartTool } from "./tools"

describe("openmath_research_start", () => {
  let directory: string

  beforeEach(() => {
    directory = temporaryCampaignDirectory()
  })

  afterEach(() => {
    removeTemporaryCampaignDirectory(directory)
  })

  test("routes a strict objective to campaign start", async () => {
    const tool = createOpenMathResearchStartTool({
      directory,
      openmathConfig: researchToolConfig(),
    })

    const result = JSON.parse(await tool.execute({
      campaign_id: "campaign-tool-start",
      objective: { kind: "markdown", instruction: "Prove it." },
    }, researchToolContext()))

    expect(result).toMatchObject({
      ok: true,
      campaign_id: "campaign-tool-start",
      state_revision: 0,
      phase: "DISCOVERY",
      status: "READY",
    })
  })

  test("rejects unknown fields", async () => {
    const tool = createOpenMathResearchStartTool({
      directory,
      openmathConfig: researchToolConfig(),
    })

    const result = JSON.parse(await tool.execute({
      campaign_id: "campaign-tool-extra",
      objective: { kind: "markdown", instruction: "Prove it." },
      actor_session_id: "ses_forged",
    }, researchToolContext()))

    expect(result).toMatchObject({ ok: false, error_code: "VALIDATION_ERROR" })
  })
})
