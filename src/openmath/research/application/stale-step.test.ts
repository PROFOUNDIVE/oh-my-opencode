import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { startResearchCampaignState } from "../storage"
import { emptyDiscoveryState } from "../transitions/transition-test-fixture"
import {
  removeTemporaryCampaignDirectory,
  temporaryCampaignDirectory,
} from "./application-test-fixture"
import { stepResearchCampaign } from "./step-research-campaign"

describe("stale campaign step", () => {
  let directory: string

  beforeEach(() => {
    directory = temporaryCampaignDirectory()
  })

  afterEach(() => {
    removeTemporaryCampaignDirectory(directory)
  })

  test("rejects stale expected revision before planning or dispatch", async () => {
    // given
    const state = emptyDiscoveryState()
    await startResearchCampaignState({ directory, state })
    let sideEffects = 0

    // when
    const result = await stepResearchCampaign({ directory, campaign_id: state.campaign_id, expected_state_revision: 8, mode: "one_stage" }, {
      plan_operation: () => {
        sideEffects += 1
        return { ok: false, error_code: "RECONCILIATION_BLOCKED", message: "must not plan" }
      },
      run_operation: async () => {
        sideEffects += 1
        return { ok: true }
      },
    })

    // then
    expect(result).toEqual({ ok: false, error_code: "STALE_STATE_REVISION", message: "Expected revision 8, found 0", current_state_revision: 0 })
    expect(sideEffects).toBe(0)
  })
})
