import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { startResearchCampaign } from "../../openmath/research/application"
import {
  objectiveSnapshot,
  profileSnapshot,
  referenceSnapshot,
  removeTemporaryCampaignDirectory,
  temporaryCampaignDirectory,
} from "../../openmath/research/application/application-test-fixture"
import { researchToolContext } from "../openmath-research-test-support"
import { createOpenMathResearchStatusTool } from "./tools"

describe("openmath_research_status", () => {
  let directory: string

  beforeEach(() => {
    directory = temporaryCampaignDirectory()
  })

  afterEach(() => {
    removeTemporaryCampaignDirectory(directory)
  })

  test("returns the campaign-specific public envelope", async () => {
    await startResearchCampaign({
      directory,
      campaign_id: "campaign-tool-status",
      parent_session_id: "ses_parent1",
    }, {
      resolve_objective: async () => objectiveSnapshot(),
      resolve_references: async () => referenceSnapshot(),
      resolve_profile: async (references) => profileSnapshot(references),
    })
    const tool = createOpenMathResearchStatusTool({ directory })

    const result = JSON.parse(await tool.execute({
      campaign_id: "campaign-tool-status",
    }, researchToolContext()))

    expect(result).toEqual({
      ok: true,
      campaign_id: "campaign-tool-status",
      state_revision: 0,
      phase: "DISCOVERY",
      status: "READY",
      awaiting_reason: null,
      candidate_summaries: [],
      candidate_details: null,
      selected_candidate_id: null,
      dossier: null,
      next_actions: [
        { action: "step_one_stage", required_state_revision: 0, reason: "READY_TO_RUN" },
        { action: "step_to_checkpoint", required_state_revision: 0, reason: "READY_TO_RUN" },
        { action: "amend", required_state_revision: 0, reason: "READY_TO_RUN" },
        { action: "abort", required_state_revision: 0, reason: "READY_TO_RUN" },
      ],
    })
  })

  test("rejects unknown fields", async () => {
    const tool = createOpenMathResearchStatusTool({ directory })

    const result = JSON.parse(await tool.execute({
      campaign_id: "campaign-tool-status",
      unexpected: true,
    }, researchToolContext()))

    expect(result).toMatchObject({ ok: false, error_code: "VALIDATION_ERROR" })
  })
})
