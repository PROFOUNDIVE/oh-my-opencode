import { describe, expect, test } from "bun:test"

import { reduceCampaignTransition, renderApplicableCampaignAmendments } from "./index"
import { awaitingState, campaignState, changed, stateFor } from "./transition-test-fixture"

describe("campaign amendments", () => {
  test("adds a deterministic revision-bound amendment", () => {
    // given
    const state = stateFor("TOURNAMENT", "READY")

    // when
    const result = reduceCampaignTransition(state, {
      type: "ADD_AMENDMENT",
      kind: "required_check",
      scope: "next_tournament",
      content: "Compare the exceptional case.",
    })

    // then
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.state.state_revision).toBe(11)
      expect(result.state.amendments).toEqual([{
        event_type: "ADDED",
        amendment_id: "amendment-11",
        kind: "required_check",
        scope: "next_tournament",
        content: "Compare the exceptional case.",
        lifecycle: "ACTIVE",
        state_revision: 11,
      }])
    }
  })

  test("retracts an active amendment and rejects stale retraction", () => {
    // given
    const added = changed(reduceCampaignTransition(stateFor("TOURNAMENT", "READY"), {
      type: "ADD_AMENDMENT",
      kind: "question",
      scope: "next_tournament",
      content: "Resolve the ambiguity.",
    }))

    // when
    const retracted = reduceCampaignTransition(added, {
      type: "RETRACT_AMENDMENT",
      amendment_id: "amendment-11",
    })
    const stale = retracted.ok
      ? reduceCampaignTransition(retracted.state, { type: "RETRACT_AMENDMENT", amendment_id: "amendment-11" })
      : retracted

    // then
    expect(retracted.ok).toBe(true)
    expect(stale).toMatchObject({ ok: false, error_code: "VALIDATION_ERROR" })
  })

  test("an inapplicable amendment does not open the tournament gate", () => {
    // given
    const paused = awaitingState("TOURNAMENT")
    const inapplicable = changed(reduceCampaignTransition(paused, {
      type: "ADD_AMENDMENT",
      kind: "question",
      scope: "next_screen",
      content: "This belongs to screening.",
    }))

    // when
    const step = reduceCampaignTransition(inapplicable, { type: "REQUEST_STEP", mode: "one_stage" })

    // then
    expect(renderApplicableCampaignAmendments(inapplicable, "TOURNAMENT")).toEqual([])
    expect(step).toMatchObject({ ok: false, error_code: "ILLEGAL_TRANSITION" })
  })

  test("consumed amendments cannot be rendered or retracted", () => {
    // given
    const state = campaignState({
      ...stateFor("TOURNAMENT", "READY"),
      state_revision: 12,
      amendments: [
        {
          event_type: "ADDED",
          amendment_id: "amendment-11",
          kind: "question",
          scope: "next_tournament",
          content: "Resolve the ambiguity.",
          lifecycle: "ACTIVE",
          state_revision: 11,
        },
        { event_type: "CONSUMED", amendment_id: "amendment-11", lifecycle: "ACTIVE", state_revision: 12 },
      ],
    })

    // when
    const rendered = renderApplicableCampaignAmendments(state, "TOURNAMENT")
    const retracted = reduceCampaignTransition(state, {
      type: "RETRACT_AMENDMENT",
      amendment_id: "amendment-11",
    })

    // then
    expect(rendered).toEqual([])
    expect(retracted).toMatchObject({ ok: false, error_code: "VALIDATION_ERROR" })
  })
})
