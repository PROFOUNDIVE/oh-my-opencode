import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { preparedJob } from "../../openmath/research/transitions/operation-test-fixture"
import { emptyDiscoveryState, strategyCandidate } from "../../openmath/research/transitions/transition-test-fixture"
import { startResearchCampaignState } from "../../openmath/research/storage"
import {
  removeTemporaryCampaignDirectory,
  temporaryCampaignDirectory,
} from "../../openmath/research/application/application-test-fixture"
import { researchToolContext } from "../openmath-research-test-support"
import { createOpenMathResearchStepTool } from "./tools"

describe("openmath_research_step", () => {
  let directory: string

  beforeEach(() => {
    directory = temporaryCampaignDirectory()
  })

  afterEach(() => {
    removeTemporaryCampaignDirectory(directory)
  })

  test("routes mode and expected revision to the campaign application", async () => {
    const state = emptyDiscoveryState()
    await startResearchCampaignState({ directory, state })
    const candidate = strategyCandidate(false)
    const tool = createOpenMathResearchStepTool({
      directory,
      createStepDependencies: () => ({
        plan_operation: () => ({
          ok: true,
          plan: {
            candidates: [candidate],
            job_attempts: [preparedJob(state, "job-discovery-direct-01", {
              kind: "CANDIDATE",
              candidate_id: candidate.candidate_id,
            })],
          },
        }),
        run_operation: async () => ({ ok: true }),
        prepare_dossier: async () => {
          throw new TypeError("discovery input must not prepare a dossier")
        },
      }),
    })

    const result = JSON.parse(await tool.execute({
      campaign_id: state.campaign_id,
      expected_state_revision: 0,
      mode: "one_stage",
    }, researchToolContext()))

    expect(result).toMatchObject({ ok: true, state_revision: 1, status: "RUNNING" })
  })

  test("rejects stale and omitted revisions", async () => {
    const state = emptyDiscoveryState()
    await startResearchCampaignState({ directory, state })
    const tool = createOpenMathResearchStepTool({
      directory,
      createStepDependencies: () => ({
        plan_operation: () => { throw new TypeError("stale input must not plan") },
        run_operation: async () => { throw new TypeError("stale input must not run") },
        prepare_dossier: async () => { throw new TypeError("stale input must not prepare") },
      }),
    })

    const stale = JSON.parse(await tool.execute({
      campaign_id: state.campaign_id,
      expected_state_revision: 4,
    }, researchToolContext()))
    const missing = JSON.parse(await tool.execute({
      campaign_id: state.campaign_id,
    }, researchToolContext()))

    expect(stale).toMatchObject({
      ok: false,
      error_code: "STALE_STATE_REVISION",
      current_state_revision: 0,
    })
    expect(missing).toMatchObject({ ok: false, error_code: "VALIDATION_ERROR" })
  })

  test("rejects unknown fields before creating execution dependencies", async () => {
    let created = 0
    const tool = createOpenMathResearchStepTool({
      directory,
      createStepDependencies: () => {
        created += 1
        throw new TypeError("invalid input must not create dependencies")
      },
    })

    const result = JSON.parse(await tool.execute({
      campaign_id: "campaign-tool-step",
      expected_state_revision: 0,
      actor_session_id: "ses_forged",
    }, researchToolContext()))

    expect(result).toMatchObject({ ok: false, error_code: "VALIDATION_ERROR" })
    expect(created).toBe(0)
  })
})
