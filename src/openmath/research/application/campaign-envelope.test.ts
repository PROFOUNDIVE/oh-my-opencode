import { describe, expect, test } from "bun:test"

import { awaitingState, emptyDiscoveryState, stateFor } from "../transitions/transition-test-fixture"
import {
  CampaignErrorEnvelopeSchema,
  CampaignSuccessEnvelopeSchema,
  campaignErrorEnvelope,
  campaignSuccessEnvelope,
} from "./campaign-envelope"

describe("campaign result envelopes", () => {
  test("returns the exact success envelope shape", () => {
    // given
    const state = emptyDiscoveryState()

    // when
    const result = campaignSuccessEnvelope(state)

    // then
    expect(Object.keys(result)).toEqual([
      "ok",
      "campaign_id",
      "state_revision",
      "phase",
      "status",
      "awaiting_reason",
      "candidate_summaries",
      "candidate_details",
      "selected_candidate_id",
      "dossier",
      "next_actions",
    ])
    expect(CampaignSuccessEnvelopeSchema.parse(result)).toEqual(result)
  })

  test("redacts candidate details before the screen barrier", () => {
    // given
    const state = stateFor("DISCOVERY", "READY")

    // when
    const result = campaignSuccessEnvelope(state)

    // then
    expect(result.candidate_summaries).toEqual([{
      candidate_id: "direct-01",
      strategy_id: "direct-proof",
      execution_status: "COMPLETED",
    }])
    expect(result.candidate_details).toBeNull()
  })

  test("exposes normalized candidate details only after the screen barrier", () => {
    // given
    const state = awaitingState("SCREENING")

    // when
    const result = campaignSuccessEnvelope(state)

    // then
    expect(result.candidate_details?.[0]).toMatchObject({
      candidate_id: "direct-01",
      candidate_kind: "STRATEGY",
      strategy_id: "direct-proof",
      parent_candidate_ids: [],
    })
    expect(result.candidate_details?.[0]?.screens[0]).toEqual({
      screen_id: "screen-direct-01",
      screen_role: "logical-soundness",
      verdict: "VIABLE",
      blocking_issues: [],
      unresolved_obligations: [],
      assumptions: [],
      novel_elements: [],
    })
    expect(result.candidate_details?.[0]?.screens[0]).not.toHaveProperty("reviewer_session_id")
  })

  test("exposes dossier only at the promotion checkpoint or promotion terminal", () => {
    // given
    const beforePromotion = awaitingState("PROMOTION")
    const promotionReady = stateFor("PROMOTION", "PROMOTION_READY")
    const beforeDossier = stateFor("PROMOTION", "READY")

    // when
    const results = [beforePromotion, promotionReady, beforeDossier].map(campaignSuccessEnvelope)

    // then
    expect(results[0]?.dossier).toMatchObject({
      canonical: false,
      mathematical_correctness_certified: false,
      human_approval_required: true,
    })
    expect(results[1]?.dossier).not.toBeNull()
    expect(results[2]?.dossier).toBeNull()
  })

  test("preserves pause and block status in ok true results", () => {
    // given
    const paused = awaitingState("SCREENING")
    const blocked = stateFor("SCREENING", "BLOCKED")

    // when
    const results = [campaignSuccessEnvelope(paused), campaignSuccessEnvelope(blocked)]

    // then
    expect(results.map(({ ok, status }) => ({ ok, status }))).toEqual([
      { ok: true, status: "AWAITING_HUMAN" },
      { ok: true, status: "BLOCKED" },
    ])
  })

  test("accepts exactly the campaign error-code union", () => {
    // given
    const codes = [
      "VALIDATION_ERROR",
      "CAMPAIGN_NOT_FOUND",
      "CAMPAIGN_ALREADY_EXISTS",
      "PROFILE_NOT_FOUND",
      "ILLEGAL_TRANSITION",
      "STALE_STATE_REVISION",
      "SOURCE_ERROR",
      "STORAGE_READ_FAILED",
      "STORAGE_WRITE_FAILED",
      "STORAGE_BUSY",
      "STORAGE_ATOMICITY_UNAVAILABLE",
      "SUBAGENT_FAILED",
      "ADAPTER_OUTPUT_INVALID",
      "RECONCILIATION_BLOCKED",
      "CHILD_WORKFLOW_FAILED",
      "DOSSIER_HASH_MISMATCH",
      "ABORTED",
    ] as const

    // when
    const results = codes.map((error_code) => campaignErrorEnvelope({ error_code, message: error_code }))

    // then
    expect(results.map((result) => CampaignErrorEnvelopeSchema.parse(result).error_code)).toEqual(codes)
    expect(CampaignErrorEnvelopeSchema.safeParse({ ok: false, error_code: "WORKFLOW_NOT_FOUND", message: "wrong" }).success).toBe(false)
  })
})
