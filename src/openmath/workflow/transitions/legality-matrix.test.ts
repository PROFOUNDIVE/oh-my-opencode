import { describe, expect, test } from "bun:test"

import { WorkflowStateV1Schema } from "../state"
import { reduceTransition } from "./index"
import { eventForMatrix, stateForFamily, type MatrixEvent, type StateFamily } from "./legality-test-fixture"

type Expected =
  | { readonly ok: true; readonly directive: "none" | "dispatch" | "reconcile"; readonly status: string }
  | { readonly ok: false; readonly error_code: "ILLEGAL_TRANSITION" }
type MatrixRow = readonly [StateFamily, MatrixEvent, Expected]

const ok = (directive: "none" | "dispatch" | "reconcile", status: string): Expected => ({ ok: true, directive, status })
const illegal = { ok: false, error_code: "ILLEGAL_TRANSITION" } as const

const MATRIX = [
  ["READY", "STEP_ONE", ok("dispatch", "RUNNING")],
  ["READY", "STEP_CHECKPOINT", ok("dispatch", "RUNNING")],
  ["READY", "ADD", ok("none", "READY")],
  ["READY", "RETRACT", ok("none", "READY")],
  ["READY", "RELOAD", ok("none", "READY")],
  ["READY", "ABORT", ok("none", "ABORTED")],
  ["READY", "COMMIT", illegal],
  ["RUNNING", "STEP_ONE", ok("reconcile", "RUNNING")],
  ["RUNNING", "STEP_CHECKPOINT", ok("reconcile", "RUNNING")],
  ["RUNNING", "ADD", illegal],
  ["RUNNING", "RETRACT", illegal],
  ["RUNNING", "RELOAD", illegal],
  ["RUNNING", "ABORT", ok("none", "RUNNING")],
  ["RUNNING", "COMMIT", ok("none", "READY")],
  ["CHECKPOINT", "STEP_ONE", ok("dispatch", "RUNNING")],
  ["CHECKPOINT", "STEP_CHECKPOINT", ok("dispatch", "RUNNING")],
  ["CHECKPOINT", "ADD", ok("none", "AWAITING_HUMAN")],
  ["CHECKPOINT", "RETRACT", ok("none", "AWAITING_HUMAN")],
  ["CHECKPOINT", "RELOAD", ok("none", "AWAITING_HUMAN")],
  ["CHECKPOINT", "ABORT", ok("none", "ABORTED")],
  ["CHECKPOINT", "COMMIT", illegal],
  ["INCONCLUSIVE_UNSATISFIED", "STEP_ONE", illegal],
  ["INCONCLUSIVE_UNSATISFIED", "STEP_CHECKPOINT", illegal],
  ["INCONCLUSIVE_UNSATISFIED", "ADD", ok("none", "AWAITING_HUMAN")],
  ["INCONCLUSIVE_UNSATISFIED", "RETRACT", ok("none", "AWAITING_HUMAN")],
  ["INCONCLUSIVE_UNSATISFIED", "RELOAD", ok("none", "AWAITING_HUMAN")],
  ["INCONCLUSIVE_UNSATISFIED", "ABORT", ok("none", "ABORTED")],
  ["INCONCLUSIVE_UNSATISFIED", "COMMIT", illegal],
  ["INCONCLUSIVE_SATISFIED", "STEP_ONE", ok("dispatch", "RUNNING")],
  ["INCONCLUSIVE_SATISFIED", "STEP_CHECKPOINT", ok("dispatch", "RUNNING")],
  ["INCONCLUSIVE_SATISFIED", "ADD", ok("none", "AWAITING_HUMAN")],
  ["INCONCLUSIVE_SATISFIED", "RETRACT", ok("none", "AWAITING_HUMAN")],
  ["INCONCLUSIVE_SATISFIED", "RELOAD", ok("none", "AWAITING_HUMAN")],
  ["INCONCLUSIVE_SATISFIED", "ABORT", ok("none", "ABORTED")],
  ["INCONCLUSIVE_SATISFIED", "COMMIT", illegal],
  ["PARSE_FAILURE_UNSATISFIED", "STEP_ONE", illegal],
  ["PARSE_FAILURE_UNSATISFIED", "STEP_CHECKPOINT", illegal],
  ["PARSE_FAILURE_UNSATISFIED", "ADD", ok("none", "AWAITING_HUMAN")],
  ["PARSE_FAILURE_UNSATISFIED", "RETRACT", ok("none", "AWAITING_HUMAN")],
  ["PARSE_FAILURE_UNSATISFIED", "RELOAD", ok("none", "AWAITING_HUMAN")],
  ["PARSE_FAILURE_UNSATISFIED", "ABORT", ok("none", "ABORTED")],
  ["PARSE_FAILURE_UNSATISFIED", "COMMIT", illegal],
  ["PARSE_FAILURE_SATISFIED", "STEP_ONE", ok("dispatch", "RUNNING")],
  ["PARSE_FAILURE_SATISFIED", "STEP_CHECKPOINT", ok("dispatch", "RUNNING")],
  ["PARSE_FAILURE_SATISFIED", "ADD", ok("none", "AWAITING_HUMAN")],
  ["PARSE_FAILURE_SATISFIED", "RETRACT", ok("none", "AWAITING_HUMAN")],
  ["PARSE_FAILURE_SATISFIED", "RELOAD", ok("none", "AWAITING_HUMAN")],
  ["PARSE_FAILURE_SATISFIED", "ABORT", ok("none", "ABORTED")],
  ["PARSE_FAILURE_SATISFIED", "COMMIT", illegal],
  ["BLOCKED", "STEP_ONE", ok("reconcile", "BLOCKED")],
  ["BLOCKED", "STEP_CHECKPOINT", illegal],
  ["BLOCKED", "ADD", illegal],
  ["BLOCKED", "RETRACT", illegal],
  ["BLOCKED", "RELOAD", illegal],
  ["BLOCKED", "ABORT", ok("none", "ABORTED")],
  ["BLOCKED", "COMMIT", illegal],
  ...terminalRows("PASSED"),
  ...terminalRows("EXHAUSTED"),
  ...terminalRows("ABORTED"),
] satisfies readonly MatrixRow[]

describe("workflow transition legality matrix", () => {
  test.each(MATRIX)("matches %s × %s", (family, eventName, expected) => {
    // given
    const state = stateForFamily(family)

    // when
    const result = reduceTransition(state, eventForMatrix(state, eventName))

    // then
    expect(result.ok).toBe(expected.ok)
    if (result.ok && expected.ok) {
      expect(result.directive).toBe(expected.directive)
      expect(result.state.status).toBe(expected.status)
      expect(WorkflowStateV1Schema.safeParse(result.state).success).toBe(true)
    } else if (!result.ok && !expected.ok) {
      expect(result.error_code).toBe(expected.error_code)
      expect(result.state).toBe(state)
      expect(result.state.state_revision).toBe(state.state_revision)
    }
  })
})

function terminalRows(family: "PASSED" | "EXHAUSTED" | "ABORTED"): readonly MatrixRow[] {
  return (["STEP_ONE", "STEP_CHECKPOINT", "ADD", "RETRACT", "RELOAD", "ABORT", "COMMIT"] as const)
    .map((event) => [family, event, illegal] as const)
}
