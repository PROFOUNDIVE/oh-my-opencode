import { describe, expect, test } from "bun:test"

import { WorkflowStateV1Schema } from "./state"
import { createWorkflowStateFixture } from "./state/test-fixture"

const added = {
  event_type: "ADDED",
  amendment_id: "amendment-1",
  kind: "required_check",
  scope: "next_review",
  content: "Check the endpoint.",
  lifecycle: "ACTIVE",
  state_revision: 1,
}

function parseHistory(amendments: readonly object[]) {
  return WorkflowStateV1Schema.safeParse({
    ...createWorkflowStateFixture(),
    state_revision: 5,
    stage_history: [],
    dispatch_attempts: [],
    amendments,
  })
}

describe("amendment event history", () => {
  test("accepts one next-review consumption followed by one retraction", () => {
    // given
    const amendments = [
      added,
      { event_type: "CONSUMED", amendment_id: "amendment-1", lifecycle: "ACTIVE", state_revision: 2 },
      { event_type: "RETRACTED", amendment_id: "amendment-1", lifecycle: "RETRACTED", state_revision: 3 },
    ]

    // when
    const result = parseHistory(amendments)

    // then
    expect(result.success).toBe(true)
  })

  test("accepts multiple next-review consumptions committed in one state revision", () => {
    // given
    const second = { ...added, amendment_id: "amendment-2", state_revision: 2 }
    const amendments = [
      added,
      second,
      { event_type: "CONSUMED", amendment_id: "amendment-1", lifecycle: "ACTIVE", state_revision: 3 },
      { event_type: "CONSUMED", amendment_id: "amendment-2", lifecycle: "ACTIVE", state_revision: 3 },
    ]

    // when
    const result = parseHistory(amendments)

    // then
    expect(result.success).toBe(true)
  })

  test("rejects orphan, repeated, wrong-scope, post-retract, and out-of-order events", () => {
    // given
    const consumed = { event_type: "CONSUMED", amendment_id: "amendment-1", lifecycle: "ACTIVE", state_revision: 2 }
    const retracted = { event_type: "RETRACTED", amendment_id: "amendment-1", lifecycle: "RETRACTED", state_revision: 3 }
    const allRemaining = { ...added, scope: "all_remaining" }
    const histories = [
      [{ ...retracted, amendment_id: "amendment-999" }],
      [{ ...consumed, amendment_id: "amendment-999" }],
      [added, consumed, { ...consumed, state_revision: 3 }],
      [added, retracted, { ...retracted, state_revision: 4 }],
      [allRemaining, consumed],
      [added, retracted, { ...consumed, state_revision: 4 }],
      [{ ...added, state_revision: 3 }, { ...consumed, state_revision: 2 }],
      [{ ...added, amendment_id: "amendment-2" }],
      [added, { ...consumed, state_revision: 1 }],
    ]

    // when
    const results = histories.map(parseHistory)

    // then
    expect(results.every((result) => !result.success)).toBe(true)
  })
})
