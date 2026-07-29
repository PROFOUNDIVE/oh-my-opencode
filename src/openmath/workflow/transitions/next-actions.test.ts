import { describe, expect, test } from "bun:test"

import { getNextActions } from "./index"
import { artifact, workflowState } from "./test-fixture"

const ALL_ACTIONS = [
  "step_one_stage",
  "step_to_checkpoint",
  "amend",
  "reload_prompts",
  "reload_references",
  "abort",
]

describe("workflow next actions", () => {
  test.each([
    [workflowState(), ALL_ACTIONS, "READY_TO_RUN"],
    [workflowState({
      status: "AWAITING_HUMAN",
      next_stage: "REVIEW",
      awaiting_reason: "CHECKPOINT",
      artifact: artifact(),
    }), ALL_ACTIONS, "CHECKPOINT_PAUSED"],
    [workflowState({
      status: "AWAITING_HUMAN",
      next_stage: "REVIEW",
      awaiting_reason: "INCONCLUSIVE",
      artifact: artifact(),
    }), ["amend", "reload_prompts", "reload_references", "abort"], "INPUT_CHANGE_REQUIRED"],
    [workflowState({
      status: "BLOCKED",
      next_stage: "SOLVE",
      blocked_reason: "ambiguous child",
    }), ["step_one_stage", "abort"], "RECONCILIATION_BLOCKED"],
  ] as const)("derives ordered actions solely from state", (state, actions, reason) => {
    // when
    const result = getNextActions(state)

    // then
    expect(result.map((action) => action.action)).toEqual(actions)
    expect(result.every((action) => action.reason === reason)).toBe(true)
    expect(result.every((action) => action.required_state_revision === state.state_revision)).toBe(true)
  })

  test.each(["RUNNING", "PASSED", "EXHAUSTED", "ABORTED"] as const)("returns no actions for %s", (status) => {
    // given
    const terminal = status === "RUNNING"
      ? workflowState({ status, next_stage: "SOLVE" })
      : workflowState({
        status,
        next_stage: null,
        abort_requested: status === "ABORTED",
        artifact: status === "PASSED" ? artifact() : null,
        latest_review: status === "PASSED" ? {
          round: 1,
          verdict: "PASS",
          raw_report: "PASS",
          raw_report_sha256: "b".repeat(64),
          findings: [],
          checks_performed: [],
          session_id: "review",
          prompt_hash: "b".repeat(64),
          reference_hash: "b".repeat(64),
          artifact_input_hash: "b".repeat(64),
        } : null,
        completed_review_rounds: status === "PASSED" ? 1 : 0,
        consecutive_passes: status === "PASSED" ? 1 : 0,
      })

    // when
    const actions = getNextActions(terminal)

    // then
    expect(actions).toEqual([])
  })
})
