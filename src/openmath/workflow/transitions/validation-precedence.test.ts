import { describe, expect, test } from "bun:test"

import type { WorkflowStateV1 } from "../state"
import { reduceTransition, type WorkflowTransitionEvent } from "./index"
import { artifact, review, workflowState } from "./test-fixture"

const MALFORMED_EVENTS = [
  { type: "ADD_AMENDMENT", kind: "bad", scope: "round:0", content: "" },
  { type: "RELOAD" },
] satisfies readonly WorkflowTransitionEvent[]

describe("workflow validation precedence", () => {
  test.each(["RUNNING", "BLOCKED", "PASSED", "EXHAUSTED", "ABORTED"] as const)(
    "rejects malformed payloads by status legality while %s",
    (status) => {
      // given
      const state = stateForStatus(status)

      // when
      const results = MALFORMED_EVENTS.map((event) => reduceTransition(state, event))

      // then
      for (const result of results) {
        expect(result).toMatchObject({ ok: false, error_code: "ILLEGAL_TRANSITION", state })
        expect(result.state).toBe(state)
        expect(result.state.state_revision).toBe(state.state_revision)
      }
    },
  )

  test.each(["READY", "AWAITING_HUMAN"] as const)(
    "validates malformed payloads after confirming %s legality",
    (status) => {
      // given
      const state = stateForStatus(status)

      // when
      const results = MALFORMED_EVENTS.map((event) => reduceTransition(state, event))

      // then
      for (const result of results) {
        expect(result).toMatchObject({ ok: false, error_code: "VALIDATION_ERROR", state })
        expect(result.state).toBe(state)
        expect(result.state.state_revision).toBe(state.state_revision)
      }
    },
  )
})

function stateForStatus(status: WorkflowStateV1["status"]): WorkflowStateV1 {
  switch (status) {
    case "READY":
      return workflowState()
    case "RUNNING":
      return workflowState({ status, next_stage: "SOLVE" })
    case "AWAITING_HUMAN":
      return workflowState({ status, next_stage: "SOLVE", awaiting_reason: "CHECKPOINT" })
    case "BLOCKED":
      return workflowState({ status, next_stage: "SOLVE", blocked_reason: "ambiguous child" })
    case "PASSED": {
      const passingReview = review(1, "PASS")
      return workflowState({
        status,
        next_stage: null,
        artifact: artifact(),
        latest_review: passingReview,
        review_history: [passingReview],
        completed_review_rounds: 1,
        consecutive_passes: 1,
      })
    }
    case "EXHAUSTED":
      return workflowState({ status, next_stage: null })
    case "ABORTED":
      return workflowState({ status, next_stage: null, abort_requested: true })
    default:
      return assertNever(status)
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected status: ${String(value)}`)
}
