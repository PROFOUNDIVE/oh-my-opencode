import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { startResearchCampaignState } from "../storage"
import { preparedJob } from "../transitions/operation-test-fixture"
import { emptyDiscoveryState, strategyCandidate } from "../transitions/transition-test-fixture"
import {
  removeTemporaryCampaignDirectory,
  temporaryCampaignDirectory,
} from "./application-test-fixture"
import { stepResearchCampaign } from "./step-research-campaign"

describe("stale operation recovery", () => {
  let directory: string

  beforeEach(() => {
    directory = temporaryCampaignDirectory()
  })

  afterEach(() => {
    removeTemporaryCampaignDirectory(directory)
  })

  test("retires a completed dead operation before acquiring the next operation", async () => {
    // given
    const state = emptyDiscoveryState()
    await startResearchCampaignState({ directory, state })
    const candidate = strategyCandidate(false)
    const operationIds: string[] = []
    const releasedTokens: string[] = []

    // when
    const result = await stepResearchCampaign({ directory, campaign_id: state.campaign_id, expected_state_revision: 0, mode: "one_stage" }, {
      plan_operation: () => ({
        ok: true,
        plan: {
          candidates: [candidate],
          job_attempts: [preparedJob(state, "job-discovery-direct-01", { kind: "CANDIDATE", candidate_id: candidate.candidate_id })],
        },
      }),
      run_operation: async () => ({ ok: true }),
      read_lock: async () => ({
        kind: "owned",
        owner: { token: "dead-token", pid: 99, operation_id: "campaign-1:operation:0", started_at: "2026-08-28T00:00:00.000Z" },
        process_status: "dead",
      }),
      acquire_lock: async ({ operation_id }) => {
        operationIds.push(operation_id)
        return {
          kind: "acquired",
          owner: { token: `token-${operation_id}`, pid: 1, operation_id, started_at: "2026-08-28T00:01:00.000Z" },
          recovered_owner: null,
        }
      },
      release_lock: async ({ token }) => {
        releasedTokens.push(token)
        return { kind: "ok" }
      },
    })

    // then
    expect(result).toMatchObject({ ok: true, status: "RUNNING", state_revision: 1 })
    expect(operationIds).toEqual(["campaign-1:operation:0", "campaign-1:operation:1"])
    expect(releasedTokens).toEqual(["token-campaign-1:operation:0", "token-campaign-1:operation:1"])
  })
})
