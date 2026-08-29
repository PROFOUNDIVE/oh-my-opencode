import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { startResearchCampaignState } from "../storage"
import { awaitingState, emptyDiscoveryState } from "../transitions/transition-test-fixture"
import { abortResearchCampaign } from "./abort-research-campaign"
import { amendResearchCampaign } from "./amend-research-campaign"
import {
  removeTemporaryCampaignDirectory,
  temporaryCampaignDirectory,
} from "./application-test-fixture"
import { promoteResearchCampaign } from "./promote-research-campaign"

describe("campaign mutations", () => {
  let directory: string

  beforeEach(() => {
    directory = temporaryCampaignDirectory()
  })

  afterEach(() => {
    removeTemporaryCampaignDirectory(directory)
  })

  test("rejects a stale campaign mutation without retrying", async () => {
    // given
    const state = emptyDiscoveryState()
    await startResearchCampaignState({ directory, state })

    // when
    const result = await abortResearchCampaign({
      directory,
      campaign_id: state.campaign_id,
      expected_state_revision: 4,
      reason: "stop",
    })

    // then
    expect(result).toEqual({
      ok: false,
      error_code: "STALE_STATE_REVISION",
      message: "Expected revision 4, found 0",
      current_state_revision: 0,
    })
  })

  test("rejects malformed Phase A amendment scope", async () => {
    // given
    const state = emptyDiscoveryState()
    await startResearchCampaignState({ directory, state })

    // when
    const result = await amendResearchCampaign({
      directory,
      campaign_id: state.campaign_id,
      expected_state_revision: 0,
      operation: "add",
      kind: "question",
      scope: "all_future_campaigns",
      content: "Check this case.",
    })

    // then
    expect(result).toMatchObject({ ok: false, error_code: "VALIDATION_ERROR" })
  })

  test("maps selected refinement to unchanged workflow all_remaining amendment", async () => {
    // given
    const state = awaitingState("DEEP_REFINEMENT")
    const workflowInputs: unknown[] = []
    const writes: unknown[] = []

    // when
    const result = await amendResearchCampaign({
      directory,
      campaign_id: state.campaign_id,
      expected_state_revision: state.state_revision,
      operation: "add",
      kind: "required_check",
      scope: "selected_refinement",
      content: "Resolve the remaining gap.",
    }, {
      read_state: async () => ({ kind: "ok", state }),
      compare_and_swap: async (request) => {
        writes.push(request)
        return { kind: "ok", state: request.next_state }
      },
      amend_workflow: async (input) => {
        workflowInputs.push(input)
        return { kind: "ok" }
      },
    })

    // then
    expect(result).toMatchObject({ ok: true, state_revision: state.state_revision + 1 })
    expect(workflowInputs).toEqual([{
      directory,
      run_id: "campaign-1::direct-01",
      expected_state_revision: 2,
      operation: "add",
      kind: "required_check",
      scope: "all_remaining",
      content: "Resolve the remaining gap.",
    }])
    expect(writes).toHaveLength(1)
  })

  test("requires a dossier and matching hash before promotion", async () => {
    // given
    const state = awaitingState("SCREENING")

    // when
    const result = await promoteResearchCampaign({
      directory,
      campaign_id: state.campaign_id,
      expected_state_revision: state.state_revision,
      dossier_sha256: "b".repeat(64),
      decision: "approve",
    }, {
      trusted_actor_receipt: { session_id: "ses_human1", message_id: "msg_human1" },
      read_state: async () => ({ kind: "ok", state }),
      compare_and_swap: async () => {
        throw new TypeError("promotion precondition must not write")
      },
    })

    // then
    expect(result).toMatchObject({ ok: false, error_code: "DOSSIER_HASH_MISMATCH" })
  })

  test("records an exact-hash promotion decision without dispatch", async () => {
    // given
    const state = awaitingState("PROMOTION")
    let writes = 0

    // when
    const result = await promoteResearchCampaign({
      directory,
      campaign_id: state.campaign_id,
      expected_state_revision: state.state_revision,
      dossier_sha256: state.dossier?.content_sha256 ?? "",
      decision: "approve",
    }, {
      trusted_actor_receipt: { session_id: "ses_human1", message_id: "msg_human1" },
      read_state: async () => ({ kind: "ok", state }),
      compare_and_swap: async (request) => {
        writes += 1
        return { kind: "ok", state: request.next_state }
      },
    })

    // then
    expect(result).toMatchObject({ ok: true, status: "PROMOTION_READY", next_actions: [] })
    expect(writes).toBe(1)
    if (result.ok) {
      expect(result.dossier).toMatchObject({ canonical: false, mathematical_correctness_certified: false, human_approval_required: true })
    }
  })

  test("returns validation error for malformed promotion actor receipt", async () => {
    // given
    const state = awaitingState("PROMOTION")

    // when
    const result = await promoteResearchCampaign({
      directory,
      campaign_id: state.campaign_id,
      expected_state_revision: state.state_revision,
      dossier_sha256: state.dossier?.content_sha256 ?? "",
      decision: "approve",
    }, {
      trusted_actor_receipt: { session_id: "", message_id: "msg_human1" },
      read_state: async () => ({ kind: "ok", state }),
      compare_and_swap: async () => {
        throw new TypeError("invalid promotion must not write")
      },
    })

    // then
    expect(result).toMatchObject({ ok: false, error_code: "VALIDATION_ERROR" })
  })
})
