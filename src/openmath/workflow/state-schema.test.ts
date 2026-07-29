import { describe, expect, test } from "bun:test"

import { parseWorkflowStateV1Json, WorkflowStateV1Schema } from "./state"
import { createWorkflowStateFixture } from "./state/test-fixture"

describe("WorkflowStateV1 schema", () => {
  test("round-trips every concrete persisted state field through JSON", () => {
    // given
    const state = createWorkflowStateFixture()

    // when
    const parsed = parseWorkflowStateV1Json(JSON.stringify(state))

    // then
    expect(parsed.kind).toBe("ok")
    if (parsed.kind === "error") throw new Error(parsed.message)
    expect(parsed.state).toEqual(WorkflowStateV1Schema.parse(state))
    expect(parsed.state.parent_session_id).toBe("parent-session-immutable")
    expect(parsed.state.dispatch_attempts[0]?.phase).toBe("PREPARED")
    expect(parsed.state.stage_history[0]).toMatchObject({
      role: "solver",
      resolved_model: { providerID: "openai", modelID: "gpt-5" },
      raw_session_id: "child-solve",
      raw_output: "solver output",
    })
  })

  test("accepts every persisted workflow status and stage-attempt phase", () => {
    // given
    const statuses = [
      createWorkflowStateFixture(),
      { ...createWorkflowStateFixture(), status: "RUNNING", next_stage: "REVIEW" },
      { ...createWorkflowStateFixture(), status: "AWAITING_HUMAN", awaiting_reason: "CHECKPOINT" },
      { ...createWorkflowStateFixture(), status: "PASSED", next_stage: null },
      { ...createWorkflowStateFixture(), status: "EXHAUSTED", next_stage: null },
      { ...createWorkflowStateFixture(), status: "ABORTED", next_stage: null, abort_requested: true },
      { ...createWorkflowStateFixture(), status: "BLOCKED", blocked_reason: "reconciliation ambiguous" },
    ]
    const fixture = createWorkflowStateFixture()
    const prepared = fixture.dispatch_attempts[0]
    const artifact = fixture.artifact
    if (artifact === null) throw new Error("Expected fixture artifact")
    const phases = [
      prepared,
      { ...prepared, phase: "SESSION_CREATED", child_session_id: "child" },
      { ...prepared, phase: "PROMPT_SENT", child_session_id: "child" },
      {
        ...prepared,
        phase: "COMPLETED",
        child_session_id: "child",
        raw_output: "output",
        output_hash: "a".repeat(64),
        receipt: { kind: "ARTIFACT", artifact },
      },
      {
        ...prepared,
        phase: "COMMITTED",
        child_session_id: "child",
        raw_output: "output",
        output_hash: "a".repeat(64),
        receipt: { kind: "ARTIFACT", artifact },
      },
    ]

    // when
    const statusResults = statuses.map((state) => WorkflowStateV1Schema.safeParse(state))
    const phaseResults = phases.map((attempt) => WorkflowStateV1Schema.safeParse({
      ...createWorkflowStateFixture(),
      dispatch_attempts: [attempt],
    }))

    // then
    expect(statusResults.every((result) => result.success)).toBe(true)
    expect(phaseResults.every((result) => result.success)).toBe(true)
  })

  test("persists completed adapter errors and exact resolved attempt models", () => {
    // given
    const fixture = createWorkflowStateFixture()
    const prepared = fixture.dispatch_attempts[0]
    const errorAttempt = {
      ...prepared,
      phase: "COMPLETED",
      child_session_id: "child-error",
      raw_output: "malformed output",
      output_hash: "b".repeat(64),
      receipt: {
        kind: "ERROR",
        error_code: "ADAPTER_OUTPUT_INVALID",
        message: "Adapter rejected the output",
        adapter_error: {
          kind: "adapter_error",
          code: "INVALID_JSON",
          message: "Output is not JSON",
          raw_output: "malformed output",
        },
      },
    }

    // when
    const result = WorkflowStateV1Schema.safeParse({
      ...fixture,
      stage_history: [],
      dispatch_attempts: [errorAttempt],
    })

    // then
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.dispatch_attempts[0]).toMatchObject({
      resolved_model: { providerID: "openai", modelID: "gpt-5" },
      prompt_hash: "a".repeat(64),
      output_hash: "b".repeat(64),
      receipt: { kind: "ERROR", error_code: "ADAPTER_OUTPUT_INVALID" },
    })
  })

  test("persists complete failed stage records without dropping receipt metadata", () => {
    // given
    const fixture = createWorkflowStateFixture()
    const failedRecord = {
      ...fixture.stage_history[0],
      outcome: "AWAITING_HUMAN",
      raw_output: "malformed output",
      output_hash: "b".repeat(64),
      parsed_result: null,
      parsed_error: {
        kind: "ERROR",
        error_code: "ADAPTER_OUTPUT_INVALID",
        message: "Adapter rejected the output",
        adapter_error: {
          kind: "adapter_error",
          code: "INVALID_JSON",
          message: "Output is not JSON",
          raw_output: "malformed output",
        },
      },
      error_code: "ADAPTER_OUTPUT_INVALID",
    }

    // when
    const result = WorkflowStateV1Schema.safeParse({ ...fixture, stage_history: [failedRecord] })

    // then
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.stage_history[0]).toMatchObject({
      role: "solver",
      resolved_model: { providerID: "openai", modelID: "gpt-5" },
      raw_session_id: "child-solve",
      output_hash: "b".repeat(64),
      parsed_error: { kind: "ERROR", error_code: "ADAPTER_OUTPUT_INVALID" },
    })
  })
})
