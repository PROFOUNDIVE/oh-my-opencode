import { describe, expect, test } from "bun:test"

import { reduceTransition } from "./index"
import { artifact, review, runningWithReceipt, withPolicy, workflowState } from "./test-fixture"

describe("workflow transition failures", () => {
  test("keeps an early PASS provisional", () => {
    // given
    const state = withPolicy(workflowState({ next_stage: "REVIEW", artifact: artifact() }), {
      min_review_rounds: 2,
    })

    // when
    const result = reduceTransition(
      runningWithReceipt(state, "REVIEW", { kind: "REVIEW", review: review(1, "PASS") }),
      { type: "COMMIT_STAGE_RECEIPT" },
    )

    // then
    expect(result).toMatchObject({ ok: true, state: { status: "READY", next_stage: "REVIEW" } })
  })

  test("exhausts an INCONCLUSIVE verdict at the maximum review round", () => {
    // given
    const state = withPolicy(workflowState({
      next_stage: "REVIEW",
      artifact: artifact(),
      review_round: 3,
      completed_review_rounds: 2,
      consecutive_passes: 1,
    }), { max_review_rounds: 3 })

    // when
    const result = reduceTransition(
      runningWithReceipt(state, "REVIEW", { kind: "REVIEW", review: review(3, "INCONCLUSIVE") }),
      { type: "COMMIT_STAGE_RECEIPT" },
    )

    // then
    expect(result).toMatchObject({
      ok: true,
      state: { status: "EXHAUSTED", completed_review_rounds: 3, consecutive_passes: 0 },
    })
  })

  test("routes a RUNNING step to reconciliation without mutation", () => {
    // given
    const state = workflowState({ status: "RUNNING", next_stage: "SOLVE" })

    // when
    const result = reduceTransition(state, { type: "STEP", mode: "one_stage" })

    // then
    expect(result).toEqual({ ok: true, directive: "reconcile", state })
  })

  test("rejects checkpoint stepping while reconciliation is blocked", () => {
    // given
    const state = workflowState({
      status: "BLOCKED",
      next_stage: "SOLVE",
      blocked_reason: "ambiguous child",
    })

    // when
    const result = reduceTransition(state, { type: "STEP", mode: "to_checkpoint" })

    // then
    expect(result).toMatchObject({ ok: false, error_code: "ILLEGAL_TRANSITION", state })
    expect(result.state).toBe(state)
  })

  test.each(["PASSED", "EXHAUSTED", "ABORTED"] as const)("rejects terminal mutation for %s unchanged", (status) => {
    // given
    const passingReview = review(1, "PASS")
    const state = workflowState({
      status,
      next_stage: null,
      abort_requested: status === "ABORTED",
      artifact: status === "PASSED" ? artifact() : null,
      latest_review: status === "PASSED" ? passingReview : null,
      review_history: status === "PASSED" ? [passingReview] : [],
      completed_review_rounds: status === "PASSED" ? 1 : 0,
      consecutive_passes: status === "PASSED" ? 1 : 0,
    })

    // when
    const result = reduceTransition(state, { type: "STEP", mode: "one_stage" })

    // then
    expect(result).toMatchObject({ ok: false, error_code: "ILLEGAL_TRANSITION", state })
    expect(result.state).toBe(state)
  })

  test("rejects duplicate retraction and bad amendment scope unchanged", () => {
    // given
    const state = workflowState({
      state_revision: 2,
      amendments: [
        {
          event_type: "ADDED",
          amendment_id: "amendment-1",
          kind: "question",
          scope: "all_remaining",
          content: "Question",
          lifecycle: "ACTIVE",
          state_revision: 1,
        },
        { event_type: "RETRACTED", amendment_id: "amendment-1", lifecycle: "RETRACTED", state_revision: 2 },
      ],
    })

    // when
    const duplicate = reduceTransition(state, { type: "RETRACT_AMENDMENT", amendment_id: "amendment-1" })
    const invalid = reduceTransition(state, {
      type: "ADD_AMENDMENT",
      kind: "question",
      scope: "round:0",
      content: "Invalid",
    })

    // then
    expect(duplicate).toMatchObject({ ok: false, error_code: "ILLEGAL_TRANSITION", state })
    expect(invalid).toMatchObject({ ok: false, error_code: "VALIDATION_ERROR", state })
    expect(duplicate.state).toBe(state)
    expect(invalid.state).toBe(state)
  })

  test("rejects step while an intervention remains unsatisfied", () => {
    // given
    const state = workflowState({
      status: "AWAITING_HUMAN",
      next_stage: "REVIEW",
      awaiting_reason: "INCONCLUSIVE",
      artifact: artifact(),
      intervention_satisfied: false,
    })

    // when
    const result = reduceTransition(state, { type: "STEP", mode: "one_stage" })

    // then
    expect(result).toMatchObject({ ok: false, error_code: "ILLEGAL_TRANSITION", state })
    expect(result.state).toBe(state)
  })

  test("suppresses a completed receipt after RUNNING abort wins", () => {
    // given
    const running = runningWithReceipt(workflowState(), "SOLVE", { kind: "ARTIFACT", artifact: artifact() })
    const aborted = reduceTransition(running, { type: "ABORT", reason: "stop" })
    if (!aborted.ok) throw new Error(aborted.message)

    // when
    const committed = reduceTransition(aborted.state, { type: "COMMIT_STAGE_RECEIPT" })

    // then
    expect(committed).toMatchObject({
      ok: true,
      state: { status: "ABORTED", artifact: null, abort_requested: true, abort_reason: "stop" },
    })
    if (committed.ok) {
      expect(committed.state.dispatch_attempts.at(-1)?.phase).toBe("COMMITTED")
      expect(committed.state.stage_history.at(-1)?.outcome).toBe("ABORTED")
    }
  })
})
