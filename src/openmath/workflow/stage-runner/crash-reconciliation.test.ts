import { describe, expect, test } from "bun:test"

import {
  reconcilePreparedAttempt,
  reconcileSessionCreatedAttempt,
} from "./attempt-reconciliation"
import { preparedAttempt } from "./test-fixture"
import { createCrashRuntime, type CrashBoundary } from "./crash-test-runtime"
import { runningWorkflowState } from "./test-fixture"
import { runWorkflowStage } from "./run-workflow-stage"
import { runWorkflowStep } from "./run-workflow-step"
import { WorkflowStateV1Schema } from "../state"
import { getNextActions } from "../transitions"

const MARKER = `OPENMATH_ATTEMPT_KEY: ${"c".repeat(64)}\n`

describe("workflow stage crash reconciliation", () => {
  test.each(["children", "get", "messages"] as const)("persists BLOCKED reconciliation evidence and next actions when %s is unqueryable", async (failure) => {
    // given
    const running = runningWorkflowState("SOLVE")
    const prepared = preparedAttempt("SOLVE")
    const attempt = failure === "messages"
      ? { ...prepared, phase: "SESSION_CREATED" as const, child_session_id: "child-1" }
      : prepared
    const state = WorkflowStateV1Schema.parse({ ...running, dispatch_attempts: [attempt] })
    const harness = createCrashRuntime(state, undefined, failure)

    // when
    const blocked = await runWorkflowStage({ state, workflow_input: "input", runtime: harness.runtime })

    // then
    expect(blocked.status).toBe("BLOCKED")
    const record = blocked.stage_history[blocked.stage_history.length - 1]
    if (!record) throw new TypeError("Expected a blocked stage record")
    expect(record).toMatchObject({ outcome: "BLOCKED", error_code: "RECONCILIATION_BLOCKED", parsed_error: { error_code: "RECONCILIATION_BLOCKED" } })
    expect(getNextActions(blocked)).toEqual([
      { action: "step_one_stage", required_state_revision: blocked.state_revision, reason: "RECONCILIATION_BLOCKED" },
      { action: "abort", required_state_revision: blocked.state_revision, reason: "RECONCILIATION_BLOCKED" },
    ])
    expect(harness.child_created).toBe(0)
    expect(harness.prompt_sent).toBe(0)
  })

  test("resumes one matching PREPARED child without creating a second child", async () => {
    const running = runningWorkflowState("SOLVE")
    const attempt = preparedAttempt("SOLVE")
    const state = WorkflowStateV1Schema.parse({ ...running, dispatch_attempts: [attempt] })
    const harness = createCrashRuntime(state, undefined)
    harness.seed_child(attempt.child_title, "existing-child")

    const result = await runWorkflowStage({ state, workflow_input: "input", runtime: harness.runtime })

    expect(result.status).toBe("READY")
    expect(harness.child_created).toBe(0)
    expect(harness.prompt_sent).toBe(1)
    expect(harness.dispatches[0]?.persisted_session_id).toBe("existing-child")
  })

  test("persists BLOCKED for multiple matching PREPARED children", async () => {
    const running = runningWorkflowState("SOLVE")
    const attempt = preparedAttempt("SOLVE")
    const state = WorkflowStateV1Schema.parse({ ...running, dispatch_attempts: [attempt] })
    const harness = createCrashRuntime(state, undefined)
    harness.seed_child(attempt.child_title, "child-1")
    harness.seed_child(attempt.child_title, "child-2")

    const blocked = await runWorkflowStage({ state, workflow_input: "input", runtime: harness.runtime })

    expectBlockedReconciliation(blocked, harness.child_created, harness.prompt_sent)
  })

  test("persists BLOCKED for multiple SESSION_CREATED prompt markers", async () => {
    const running = runningWorkflowState("SOLVE")
    const prepared = preparedAttempt("SOLVE")
    const attempt = { ...prepared, phase: "SESSION_CREATED" as const, child_session_id: "child-1" }
    const state = WorkflowStateV1Schema.parse({ ...running, dispatch_attempts: [attempt] })
    const harness = createCrashRuntime(state, undefined)
    const marker = `OPENMATH_ATTEMPT_KEY: ${attempt.idempotency_key}\n`
    harness.seed_message(marker)
    harness.seed_message(`${marker}payload`)

    const blocked = await runWorkflowStage({ state, workflow_input: "input", runtime: harness.runtime })

    expectBlockedReconciliation(blocked, harness.child_created, harness.prompt_sent)
  })

  test("commits SOLVE REVIEW REVISE once each with immutable role snapshots", async () => {
    // given
    const running = runningWorkflowState("SOLVE")
    const initial = WorkflowStateV1Schema.parse({
      ...running,
      status: "READY",
      awaiting_reason: null,
      abort_requested: false,
      abort_reason: null,
      blocked_reason: null,
      intervention_satisfied: false,
    })
    const harness = createCrashRuntime(initial, undefined)

    // when
    const solved = await runWorkflowStep({ state: initial, workflow_input: "input", mode: "one_stage", runtime: harness.runtime })
    if (solved.status !== "READY") throw new TypeError("Expected REVIEW readiness")
    const reviewed = await runWorkflowStep({ state: solved, workflow_input: "input", mode: "one_stage", runtime: harness.runtime })
    if (reviewed.status !== "READY") throw new TypeError("Expected REVISE readiness")
    const revised = await runWorkflowStep({ state: reviewed, workflow_input: "input", mode: "one_stage", runtime: harness.runtime })

    // then
    expect(revised.status).toBe("READY")
    expect(harness.dispatches.map((dispatch) => dispatch.agent_to_use)).toEqual(["solver", "reviewer", "reviser"])
    expect(harness.dispatches.map((dispatch) => dispatch.category_model.variant)).toEqual(["high", "high", "high"])
    expect(harness.dispatches.map((dispatch) => dispatch.system_content)).toEqual(["solve system", "review system", "revise system"])
    expect(revised.stage_history.slice(-3).map((record) => record.stage)).toEqual(["SOLVE", "REVIEW", "REVISE"])
    expect(revised.stage_history.slice(-3).every((record) => record.raw_session_id === "child-1")).toBe(true)
  })

  test.each(["PREPARED", "CHILD_CREATED", "SESSION_CREATED", "PROMPT_APPENDED", "PROMPT_SENT", "OUTPUT_FETCHED", "COMPLETED"] as const)("restarts from a persisted %s boundary without duplicate child, prompt, receipt, or commit", async (boundary: CrashBoundary) => {
    // given
    const initial = runningWorkflowState("SOLVE")
    const harness = createCrashRuntime(initial, boundary)

    // when
    await expect(runWorkflowStage({ state: initial, workflow_input: "input", runtime: harness.runtime })).rejects.toThrow(`crash after ${boundary}`)
    const persistedAttempt = harness.state.dispatch_attempts[0]
    if (!persistedAttempt) throw new TypeError("Expected a persisted attempt")
    const key = persistedAttempt.idempotency_key
    harness.resume()
    const resumed = await runWorkflowStage({ state: harness.state, workflow_input: "input", runtime: harness.runtime })

    // then
    expect(resumed.status).toBe("READY")
    expect(harness.child_created).toBe(1)
    expect(harness.prompt_sent).toBe(1)
    expect(harness.parent_lookups.every((parent) => parent === "parent-session-immutable")).toBe(true)
    expect(resumed.dispatch_attempts.filter((attempt) => attempt.idempotency_key === key)).toHaveLength(1)
    expect(resumed.stage_history.filter((record) => record.attempt_key === key)).toHaveLength(1)
    expect(harness.phase_history.filter((phase) => phase === "COMPLETED")).toHaveLength(1)
    expect(harness.phase_history.filter((phase) => phase === "COMMITTED")).toHaveLength(1)
  })

  test("uses the persisted parent to create exactly one child when no title matches", async () => {
    // given
    const parents: string[] = []
    const attempt = preparedAttempt("SOLVE")

    // when
    const result = await reconcilePreparedAttempt({
      parent_session_id: "persisted-parent",
      attempt,
      list_children: async (parent) => {
        parents.push(parent)
        return [{ id: "unrelated" }]
      },
      get_session: async () => ({ title: "different title" }),
    })

    // then
    expect(parents).toEqual(["persisted-parent"])
    expect(result).toEqual({ kind: "create", child_title: attempt.child_title })
  })

  test("blocks PREPARED reconciliation when multiple children carry the exact key title", async () => {
    // given
    const attempt = preparedAttempt("REVIEW")

    // when
    const result = await reconcilePreparedAttempt({
      parent_session_id: "persisted-parent",
      attempt,
      list_children: async () => [{ id: "child-1" }, { id: "child-2" }],
      get_session: async () => ({ title: attempt.child_title }),
    })

    // then
    expect(result).toEqual({ kind: "blocked", message: "Multiple child sessions match the persisted attempt key" })
  })

  test.each([
    [[], { kind: "send" }],
    [[{ role: "user", text: MARKER + "payload" }], { kind: "resume" }],
    [[{ role: "user", text: MARKER }, { role: "user", text: MARKER + "payload" }], { kind: "blocked", message: "Multiple user prompts match the persisted attempt key" }],
  ] as const)("reconciles SESSION_CREATED prompt marker cardinality", async (messages, expected) => {
    // given
    const attempt = { ...preparedAttempt("REVISE"), phase: "SESSION_CREATED" as const, child_session_id: "child-1" }

    // when
    const result = await reconcileSessionCreatedAttempt({
      attempt,
      list_messages: async () => messages,
    })

    // then
    expect(result).toEqual(expected)
  })
})

function expectBlockedReconciliation(state: import("../state").WorkflowStateV1, childCreated: number, promptSent: number): void {
  expect(state.status).toBe("BLOCKED")
  const record = state.stage_history[state.stage_history.length - 1]
  if (!record) throw new TypeError("Expected blocked record")
  expect(record).toMatchObject({ outcome: "BLOCKED", error_code: "RECONCILIATION_BLOCKED", parsed_error: { error_code: "RECONCILIATION_BLOCKED" } })
  expect(getNextActions(state)).toEqual([
    { action: "step_one_stage", required_state_revision: state.state_revision, reason: "RECONCILIATION_BLOCKED" },
    { action: "abort", required_state_revision: state.state_revision, reason: "RECONCILIATION_BLOCKED" },
  ])
  expect(childCreated).toBe(0)
  expect(promptSent).toBe(0)
}
