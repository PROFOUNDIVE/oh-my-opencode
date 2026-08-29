import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { stepResearchCampaign } from "../../openmath/research/application"
import {
  removeTemporaryCampaignDirectory,
  temporaryCampaignDirectory,
} from "../../openmath/research/application/application-test-fixture"
import { createPassedCampaign } from "../../openmath/research/dossier/dossier-test-support"
import { createPromotionDossierStepDependencies } from "../../openmath/research/dossier"
import { readResearchCampaignState } from "../../openmath/research/storage"
import { researchToolContext } from "../openmath-research-test-support"
import { createOpenMathResearchPromoteTool } from "./tools"

describe("openmath_research_promote", () => {
  let directory: string

  beforeEach(() => {
    directory = temporaryCampaignDirectory()
  })

  afterEach(() => {
    removeTemporaryCampaignDirectory(directory)
  })

  test("takes actor identity only from trusted tool context", async () => {
    const checkpoint = await promotionCheckpoint(directory)
    const tool = createOpenMathResearchPromoteTool({ directory })

    const result = JSON.parse(await tool.execute({
      campaign_id: checkpoint.campaign_id,
      expected_state_revision: checkpoint.state_revision,
      dossier_sha256: checkpoint.dossier_sha256,
      decision: "approve",
    }, researchToolContext("ses_trusted1", "msg_trusted1")))
    const stored = await readResearchCampaignState(directory, checkpoint.campaign_id)

    expect(result).toMatchObject({
      ok: true,
      status: "PROMOTION_READY",
      next_actions: [],
      dossier: {
        canonical: false,
        mathematical_correctness_certified: false,
        human_approval_required: true,
      },
    })
    expect(stored).toMatchObject({
      kind: "ok",
      state: {
        decision_receipt: {
          actor_session_id: "ses_trusted1",
          actor_message_id: "msg_trusted1",
        },
      },
    })
  })

  test("rejects forged actor input and stale promotion", async () => {
    const checkpoint = await promotionCheckpoint(directory)
    const tool = createOpenMathResearchPromoteTool({ directory })

    const forged = JSON.parse(await tool.execute({
      campaign_id: checkpoint.campaign_id,
      expected_state_revision: checkpoint.state_revision,
      dossier_sha256: checkpoint.dossier_sha256,
      decision: "approve",
      actor_session_id: "ses_forged1",
    }, researchToolContext()))
    const stale = JSON.parse(await tool.execute({
      campaign_id: checkpoint.campaign_id,
      expected_state_revision: checkpoint.state_revision - 1,
      dossier_sha256: checkpoint.dossier_sha256,
      decision: "approve",
    }, researchToolContext()))

    expect(forged).toMatchObject({ ok: false, error_code: "VALIDATION_ERROR" })
    expect(stale).toMatchObject({
      ok: false,
      error_code: "STALE_STATE_REVISION",
      current_state_revision: checkpoint.state_revision,
    })
  })
})

async function promotionCheckpoint(directory: string) {
  const passed = await createPassedCampaign(directory)
  const checkpoint = await stepResearchCampaign({
    directory,
    campaign_id: passed.campaign.campaign_id,
    expected_state_revision: passed.campaign.state_revision,
    mode: "one_stage",
  }, createPromotionDossierStepDependencies({ directory }))
  if (!checkpoint.ok || checkpoint.dossier === null) {
    throw new TypeError("Promotion checkpoint is unavailable")
  }
  return {
    campaign_id: checkpoint.campaign_id,
    state_revision: checkpoint.state_revision,
    dossier_sha256: checkpoint.dossier.content_sha256,
  }
}
