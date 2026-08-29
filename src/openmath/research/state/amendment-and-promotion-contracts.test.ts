import { describe, expect, test } from "bun:test"

import {
  CampaignAmendmentHistorySchema,
  PromotionDecisionReceiptSchema,
  PromotionDossierReferenceSchema,
} from "./index"
import { dossier as dossierFixture } from "./promotion-test-fixture"

describe("campaign amendments", () => {
  test("accepts append-ordered add, consume, and retract lifecycle events", () => {
    // given
    const events = [
      added("amendment-2", 2, "next_screen"),
      { event_type: "CONSUMED", amendment_id: "amendment-2", lifecycle: "ACTIVE", state_revision: 3 },
      added("amendment-4", 4, "candidate:direct-01"),
      { event_type: "RETRACTED", amendment_id: "amendment-4", lifecycle: "RETRACTED", state_revision: 5 },
    ]

    // when
    const parsed = CampaignAmendmentHistorySchema.safeParse(events)

    // then
    expect(parsed.success).toBe(true)
  })

  test("rejects unknown scopes, lifecycle-before-add, duplicate IDs, consumed retraction, and revision rollback", () => {
    // given
    const invalid = [
      [added("amendment-2", 2, "obligation:L3")],
      [{ event_type: "CONSUMED", amendment_id: "amendment-2", lifecycle: "ACTIVE", state_revision: 3 }],
      [added("amendment-2", 2, "next_screen"), added("amendment-2", 3, "next_screen")],
      [
        added("amendment-2", 2, "next_screen"),
        { event_type: "CONSUMED", amendment_id: "amendment-2", lifecycle: "ACTIVE", state_revision: 3 },
        { event_type: "RETRACTED", amendment_id: "amendment-2", lifecycle: "RETRACTED", state_revision: 4 },
      ],
      [added("amendment-3", 3, "next_screen"), added("amendment-2", 2, "next_screen")],
    ]

    // when
    const results = invalid.map((events) => CampaignAmendmentHistorySchema.safeParse(events))

    // then
    expect(results.every((result) => !result.success)).toBe(true)
  })
})

describe("promotion references", () => {
  test("binds a dossier reference to campaign, selected artifact, and frozen source hashes", () => {
    // given
    const input = dossier()

    // when
    const parsed = PromotionDossierReferenceSchema.parse(input)

    // then
    expect(parsed).toEqual({ ...input, attachments: [] })
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.attachments)).toBe(true)
  })

  test("records only an explicit approve or reject decision from a branded caller session", () => {
    // given
    const approve = {
      campaign_id: "campaign-1",
      campaign_revision: 9,
      state_revision: 10,
      dossier_sha256: dossierFixture().content_sha256,
      decision: "approve",
      actor_session_id: "ses_humanCaller1",
      actor_message_id: "msg_humanCaller1",
    }
    const forged = { ...approve, canonical: true }

    // when
    const parsed = PromotionDecisionReceiptSchema.safeParse(approve)
    const rejected = PromotionDecisionReceiptSchema.safeParse(forged)

    // then
    expect(parsed.success).toBe(true)
    expect(rejected.success).toBe(false)
  })
})

function added(amendmentId: string, stateRevision: number, scope: string) {
  return {
    event_type: "ADDED",
    amendment_id: amendmentId,
    kind: "suspected_blocker",
    scope,
    content: "Check the boundary condition.",
    lifecycle: "ACTIVE",
    state_revision: stateRevision,
  }
}

function dossier() {
  return dossierFixture()
}
