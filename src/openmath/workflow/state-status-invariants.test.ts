import { describe, expect, test } from "bun:test"

import { WorkflowStateV1Schema } from "./state"
import { createWorkflowStateFixture } from "./state/test-fixture"

function stateWithoutHistory() {
  return { ...createWorkflowStateFixture(), amendments: [], stage_history: [], dispatch_attempts: [] }
}

function initialState() {
  return {
    ...stateWithoutHistory(),
    artifact: null,
    latest_review: null,
    review_history: [],
    completed_review_rounds: 0,
    consecutive_passes: 0,
    legacy_projection: { kind: "none" },
  }
}

describe("WorkflowStateV1 status invariants", () => {
  test("accepts every legal start, pause, reconciliation, and terminal control", () => {
    // given
    const artifactState = stateWithoutHistory()
    const emptyState = initialState()
    const states = [
      { ...emptyState, status: "READY", next_stage: "SOLVE" },
      { ...artifactState, status: "READY", next_stage: "REVIEW" },
      { ...artifactState, status: "READY", next_stage: "REVISE" },
      { ...emptyState, status: "RUNNING", next_stage: "SOLVE" },
      { ...artifactState, status: "RUNNING", next_stage: "REVIEW", abort_requested: true },
      { ...artifactState, status: "AWAITING_HUMAN", next_stage: "REVIEW", awaiting_reason: "CHECKPOINT" },
      { ...artifactState, status: "AWAITING_HUMAN", next_stage: "REVIEW", awaiting_reason: "INCONCLUSIVE", intervention_satisfied: true },
      { ...emptyState, status: "AWAITING_HUMAN", next_stage: "SOLVE", awaiting_reason: "PARSE_FAILURE" },
      { ...emptyState, status: "BLOCKED", next_stage: "SOLVE", blocked_reason: "ambiguous child" },
      { ...artifactState, status: "PASSED", next_stage: null },
      { ...emptyState, status: "EXHAUSTED", next_stage: null },
      { ...artifactState, status: "EXHAUSTED", next_stage: null, latest_review: { ...artifactState.latest_review, verdict: "REVISE" }, consecutive_passes: 0 },
      { ...emptyState, status: "ABORTED", next_stage: null, abort_requested: true },
    ]

    // when
    const results = states.map((state) => WorkflowStateV1Schema.safeParse(state))

    // then
    expect(results.every((result) => result.success)).toBe(true)
  })

  test("rejects impossible status, stage, reason, abort, and artifact combinations", () => {
    // given
    const artifactState = stateWithoutHistory()
    const emptyState = initialState()
    const states = [
      { ...artifactState, status: "READY", next_stage: null },
      { ...artifactState, status: "READY", awaiting_reason: "CHECKPOINT" },
      { ...artifactState, status: "PASSED", next_stage: "REVIEW" },
      { ...artifactState, abort_reason: "stop", abort_requested: false },
      { ...artifactState, status: "BLOCKED", blocked_reason: null },
      { ...emptyState, next_stage: "REVIEW" },
      { ...emptyState, next_stage: "REVISE" },
      { ...artifactState, artifact_version: 2 },
      { ...artifactState, abort_requested: true },
      { ...artifactState, blocked_reason: "not blocked" },
      { ...emptyState, status: "RUNNING", next_stage: null },
      { ...emptyState, status: "ABORTED", next_stage: null, abort_requested: false },
      { ...emptyState, status: "AWAITING_HUMAN", next_stage: "SOLVE", awaiting_reason: "INCONCLUSIVE" },
      { ...artifactState, status: "AWAITING_HUMAN", next_stage: "REVISE", awaiting_reason: "INCONCLUSIVE" },
      { ...artifactState, status: "READY", next_stage: "SOLVE" },
      { ...artifactState, status: "PASSED", next_stage: null, latest_review: null, completed_review_rounds: 0, consecutive_passes: 0 },
      { ...artifactState, completed_review_rounds: 1, consecutive_passes: 2 },
      { ...artifactState, review_round: 1, completed_review_rounds: 2, consecutive_passes: 1 },
      { ...artifactState, status: "PASSED", next_stage: null, latest_review: { ...artifactState.latest_review, verdict: "REVISE" } },
    ]

    // when
    const results = states.map((state) => WorkflowStateV1Schema.safeParse(state))

    // then
    expect(results.every((result) => !result.success)).toBe(true)
  })
})
