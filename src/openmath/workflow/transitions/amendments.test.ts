import { describe, expect, test } from "bun:test"

import { reduceTransition, renderApplicableAmendments } from "./index"
import { artifact, review, runningWithReceipt, workflowState } from "./test-fixture"

function changed(state: ReturnType<typeof workflowState>, event: Parameters<typeof reduceTransition>[1]) {
  const result = reduceTransition(state, event)
  if (!result.ok) throw new Error(result.message)
  return result.state
}

describe("workflow amendments", () => {
  test("adds deterministic revision IDs and renders active applicable scopes", () => {
    // given
    let state = workflowState({ state_revision: 4, next_stage: "REVIEW", artifact: artifact(), review_round: 2 })

    // when
    state = changed(state, {
      type: "ADD_AMENDMENT",
      kind: "required_check",
      scope: "next_review",
      content: "Check the boundary.",
    })
    state = changed(state, {
      type: "ADD_AMENDMENT",
      kind: "question",
      scope: "round:3",
      content: "Future question.",
    })
    const rendered = renderApplicableAmendments(state, "REVIEW")

    // then
    expect(state.amendments[0]).toMatchObject({ amendment_id: "amendment-5", state_revision: 5 })
    expect(rendered).toEqual([{
      amendment_id: "amendment-5",
      kind: "required_check",
      scope: "next_review",
      content: "Check the boundary.",
    }])
  })

  test("consumes next-review amendments on committed review without deleting history", () => {
    // given
    const amended = changed(workflowState({ next_stage: "REVIEW", artifact: artifact() }), {
      type: "ADD_AMENDMENT",
      kind: "question",
      scope: "next_review",
      content: "Check this review.",
    })
    const running = runningWithReceipt(amended, "REVIEW", { kind: "REVIEW", review: review(1, "PASS") })

    // when
    const result = changed(running, { type: "COMMIT_STAGE_RECEIPT" })

    // then
    expect(result.amendments).toHaveLength(2)
    expect(result.amendments[1]).toEqual({
      event_type: "CONSUMED",
      amendment_id: "amendment-1",
      lifecycle: "ACTIVE",
      state_revision: 2,
    })
    expect(renderApplicableAmendments(result, "REVIEW")).toEqual([])
  })

  test("retracts active amendments by appending lifecycle history", () => {
    // given
    const amended = changed(workflowState(), {
      type: "ADD_AMENDMENT",
      kind: "scope_change",
      scope: "all_remaining",
      content: "Use the alternate scope.",
    })

    // when
    const retracted = changed(amended, { type: "RETRACT_AMENDMENT", amendment_id: "amendment-1" })

    // then
    expect(retracted.amendments).toEqual([
      amended.amendments[0],
      { event_type: "RETRACTED", amendment_id: "amendment-1", lifecycle: "RETRACTED", state_revision: 2 },
    ])
    expect(renderApplicableAmendments(retracted, "SOLVE")).toEqual([])
  })

  test("satisfies an inconclusive pause only with an applicable amendment", () => {
    // given
    const paused = workflowState({
      status: "AWAITING_HUMAN",
      next_stage: "REVIEW",
      awaiting_reason: "INCONCLUSIVE",
      artifact: artifact(),
      intervention_satisfied: false,
      review_round: 2,
    })

    // when
    const future = changed(paused, {
      type: "ADD_AMENDMENT",
      kind: "question",
      scope: "round:3",
      content: "Ask later.",
    })
    const applicable = changed(future, {
      type: "ADD_AMENDMENT",
      kind: "suspected_blocker",
      scope: "all_remaining",
      content: "Resolve now.",
    })

    // then
    expect(future.intervention_satisfied).toBe(false)
    expect(applicable.intervention_satisfied).toBe(true)
  })

  test("reloads immutable snapshots without leaving a paused state", () => {
    // given
    const paused = workflowState({
      status: "AWAITING_HUMAN",
      next_stage: "REVIEW",
      awaiting_reason: "PARSE_FAILURE",
      artifact: artifact(),
    })
    const profileSnapshot = {
      ...paused.profile_snapshot,
      solve: {
        ...paused.profile_snapshot.solve,
        model: { ...paused.profile_snapshot.solve.model, modelID: "reloaded" },
      },
    }

    // when
    const reloaded = changed(paused, { type: "RELOAD", profile_snapshot: profileSnapshot })

    // then
    expect(reloaded).toMatchObject({
      state_revision: 1,
      status: "AWAITING_HUMAN",
      next_stage: "REVIEW",
      awaiting_reason: "PARSE_FAILURE",
      intervention_satisfied: true,
      profile_snapshot: { solve: { model: { modelID: "reloaded" } } },
    })
  })
})
