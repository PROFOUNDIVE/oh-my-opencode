import { describe, expect, test } from "bun:test"

import { createInitialWorkflowState, reduceTransition } from "./index"
import { artifact, review, runningWithReceipt, withPolicy, workflowState } from "./test-fixture"

function committed(state: ReturnType<typeof workflowState>) {
  const result = reduceTransition(state, { type: "COMMIT_STAGE_RECEIPT" })
  if (!result.ok) throw new Error(result.message)
  return result.state
}

describe("workflow stage transitions", () => {
  test("starts without an artifact at SOLVE", () => {
    // given
    const fixture = workflowState()

    // when
    const state = createInitialWorkflowState({
      run_id: "new-run",
      parent_session_id: "parent",
      profile_snapshot: fixture.profile_snapshot,
      reference_snapshot: fixture.reference_snapshot,
    })

    // then
    expect(state).toMatchObject({
      state_revision: 0,
      status: "READY",
      next_stage: "SOLVE",
      review_round: 1,
      completed_review_rounds: 0,
      consecutive_passes: 0,
    })
  })

  test("moves SOLVE to REVIEW and REVISE back to REVIEW", () => {
    // given
    const solved = runningWithReceipt(workflowState(), "SOLVE", { kind: "ARTIFACT", artifact: artifact() })

    // when
    const afterSolve = committed(solved)
    const revised = runningWithReceipt(afterSolve, "REVISE", { kind: "ARTIFACT", artifact: artifact(2) })
    const afterRevise = committed(revised)

    // then
    expect(afterSolve).toMatchObject({ status: "READY", next_stage: "REVIEW", artifact_version: 1 })
    expect(afterRevise).toMatchObject({ status: "READY", next_stage: "REVIEW", artifact_version: 2 })
  })

  test("moves a REVISE review verdict to REVISE and resets consecutive passes", () => {
    // given
    const current = workflowState({
      status: "RUNNING",
      next_stage: "REVIEW",
      artifact: artifact(),
      completed_review_rounds: 1,
      consecutive_passes: 1,
    })
    const running = runningWithReceipt(current, "REVIEW", { kind: "REVIEW", review: review(1, "REVISE") })

    // when
    const result = committed(running)

    // then
    expect(result).toMatchObject({
      status: "READY",
      next_stage: "REVISE",
      review_round: 2,
      completed_review_rounds: 2,
      consecutive_passes: 0,
    })
  })

  test("requires five completed reviews before terminal PASS", () => {
    // given
    let state = withPolicy(workflowState({ next_stage: "REVIEW", artifact: artifact() }), {
      min_review_rounds: 5,
      max_review_rounds: 5,
    })

    // when
    for (let round = 1; round <= 5; round += 1) {
      state = committed(runningWithReceipt(state, "REVIEW", { kind: "REVIEW", review: review(round, "PASS") }))
      if (round < 5) expect(state.status).toBe("READY")
    }

    // then
    expect(state).toMatchObject({ status: "PASSED", completed_review_rounds: 5, consecutive_passes: 5 })
  })

  test("requires adjacent PASS verdicts", () => {
    // given
    let state = withPolicy(workflowState({ next_stage: "REVIEW", artifact: artifact() }), {
      max_review_rounds: 4,
      required_consecutive_passes: 2,
    })

    // when
    state = committed(runningWithReceipt(state, "REVIEW", { kind: "REVIEW", review: review(1, "PASS") }))
    const provisional = state
    state = committed(runningWithReceipt(state, "REVIEW", { kind: "REVIEW", review: review(2, "REVISE") }))
    const reset = state
    state = committed(runningWithReceipt(state, "REVISE", { kind: "ARTIFACT", artifact: artifact(2) }))
    state = committed(runningWithReceipt(state, "REVIEW", { kind: "REVIEW", review: review(3, "PASS") }))
    state = committed(runningWithReceipt(state, "REVIEW", { kind: "REVIEW", review: review(4, "PASS") }))

    // then
    expect(provisional).toMatchObject({ status: "READY", next_stage: "REVIEW", consecutive_passes: 1 })
    expect(reset).toMatchObject({ status: "READY", next_stage: "REVISE", consecutive_passes: 0 })
    expect(state.status).toBe("PASSED")
  })

  test.each([
    ["after_solve", "SOLVE", "CHECKPOINT"],
    ["after_review", "REVIEW", "CHECKPOINT"],
    ["every_stage", "SOLVE", "CHECKPOINT"],
    ["every_stage", "REVISE", "CHECKPOINT"],
    ["none", "SOLVE", null],
  ] as const)("applies %s after committed %s", (checkpoint, stage, awaitingReason) => {
    // given
    const base = withPolicy(workflowState({
      next_stage: stage,
      artifact: stage === "SOLVE" ? null : artifact(),
    }), {
      checkpoint,
      min_review_rounds: 2,
    })
    const receipt = stage === "REVIEW"
      ? { kind: "REVIEW" as const, review: review(1, "PASS") }
      : { kind: "ARTIFACT" as const, artifact: artifact(stage === "REVISE" ? 2 : 1) }

    // when
    const state = committed(runningWithReceipt(base, stage, receipt))

    // then
    expect(state.status).toBe(awaitingReason ? "AWAITING_HUMAN" : "READY")
    expect(state.awaiting_reason).toBe(awaitingReason)
  })
})
