import { expect, test } from "bun:test"

import { stepResearchCampaign } from "../application"
import {
  removeTemporaryCampaignDirectory,
  temporaryCampaignDirectory,
} from "../application/application-test-fixture"
import { startResearchCampaignState } from "../storage"
import { preparedJob } from "../transitions/operation-test-fixture"
import { emptyDiscoveryState, strategyCandidate } from "../transitions/transition-test-fixture"

test("allows only one concurrent explicit step to enter campaign dispatch", async () => {
  // given
  const directory = temporaryCampaignDirectory()
  const initial = emptyDiscoveryState()
  await startResearchCampaignState({ directory, state: initial })
  const candidate = strategyCandidate(false)
  let dispatches = 0
  let enteredDispatch: (() => void) | undefined
  let releaseDispatch: (() => void) | undefined
  const entered = new Promise<void>((resolve) => { enteredDispatch = resolve })
  const held = new Promise<void>((resolve) => { releaseDispatch = resolve })
  const dependencies = {
    plan_operation: () => ({
      ok: true as const,
      plan: {
        candidates: [candidate],
        job_attempts: [preparedJob(initial, "job-discovery-direct-01", { kind: "CANDIDATE" as const, candidate_id: candidate.candidate_id })],
      },
    }),
    run_operation: async () => {
      dispatches += 1
      enteredDispatch?.()
      await held
      return { ok: true as const }
    },
  }

  try {
    // when
    const first = stepResearchCampaign({
      directory,
      campaign_id: initial.campaign_id,
      expected_state_revision: 0,
      mode: "one_stage",
    }, dependencies)
    await entered
    const second = await stepResearchCampaign({
      directory,
      campaign_id: initial.campaign_id,
      expected_state_revision: 1,
      mode: "one_stage",
    }, dependencies)
    releaseDispatch?.()
    const completed = await first

    // then
    expect(second).toMatchObject({ ok: false, error_code: "STORAGE_BUSY" })
    expect(completed).toMatchObject({ ok: true, status: "RUNNING" })
    expect(dispatches).toBe(1)
  } finally {
    releaseDispatch?.()
    removeTemporaryCampaignDirectory(directory)
  }
})
