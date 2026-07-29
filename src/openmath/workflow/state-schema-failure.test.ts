import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { importLegacySolveOnlyState, parseWorkflowStateV1Json, WorkflowStateV1Schema } from "./state"
import { createWorkflowStateFixture } from "./state/test-fixture"

describe("WorkflowStateV1 failure handling", () => {
  test("returns typed read errors for corrupt JSON, unsupported versions, and missing snapshots without rewriting input", () => {
    // given
    const directory = mkdtempSync(join(tmpdir(), "openmath-workflow-state-failure-"))
    const path = join(directory, "state.json")
    const corrupt = "{not-json"
    writeFileSync(path, corrupt, "utf8")
    const { profile_snapshot, ...missingSnapshot } = createWorkflowStateFixture()

    // when
    const corruptResult = parseWorkflowStateV1Json(readFileSync(path, "utf8"))
    const futureResult = parseWorkflowStateV1Json(JSON.stringify({ ...createWorkflowStateFixture(), schema_version: 2 }))
    const missingResult = parseWorkflowStateV1Json(JSON.stringify(missingSnapshot))

    // then
    expect(corruptResult).toMatchObject({ kind: "error", error_code: "STORAGE_READ_FAILED" })
    expect(futureResult).toMatchObject({ kind: "error", error_code: "STORAGE_READ_FAILED" })
    expect(missingResult).toMatchObject({ kind: "error", error_code: "STORAGE_READ_FAILED" })
    expect(readFileSync(path, "utf8")).toBe(corrupt)
    rmSync(directory, { recursive: true, force: true })
  })

  test("rejects duplicate amendment IDs and a mismatched legacy source hash", () => {
    // given
    const state = createWorkflowStateFixture()
    const duplicateAmendment = { ...state.amendments[0], state_revision: 4 }
    const sourceBytes = new TextEncoder().encode(JSON.stringify({
      session_id: "legacy::p1",
      artifact_state: "DRAFT",
      artifact_version: 1,
      review_round: 1,
      max_review_rounds: 3,
      hint_budget_state: { hints_used: 0, hint_budget: 3 },
      frozen_artifacts: null,
    }))
    const existing = WorkflowStateV1Schema.parse({ ...state, legacy_source_hash: "b".repeat(64) })

    // when
    const duplicateResult = WorkflowStateV1Schema.safeParse({
      ...state,
      amendments: [...state.amendments, duplicateAmendment],
    })
    const importResult = importLegacySolveOnlyState({
      source_bytes: sourceBytes,
      parent_session_id: "parent",
      legacy_profile_name: "legacy-educational-json",
      invocation: "solve_only",
      profile_snapshot: state.profile_snapshot,
      reference_snapshot: state.reference_snapshot,
      existing_state: existing,
    })

    // then
    expect(duplicateResult.success).toBe(false)
    expect(importResult).toMatchObject({ kind: "error", error_code: "STORAGE_READ_FAILED" })
  })

  test("skips import unless a legacy profile is explicitly invoked by solve-only", () => {
    // given
    const state = createWorkflowStateFixture()
    const sourceBytes = new TextEncoder().encode(JSON.stringify({
      session_id: "legacy::p1",
      artifact_state: "DRAFT",
      artifact_version: 1,
      review_round: 1,
      max_review_rounds: 3,
      hint_budget_state: { hints_used: 0, hint_budget: 3 },
      frozen_artifacts: null,
    }))

    // when
    const result = importLegacySolveOnlyState({
      source_bytes: sourceBytes,
      parent_session_id: "parent",
      legacy_profile_name: "research-full-markdown",
      invocation: "workflow",
      profile_snapshot: state.profile_snapshot,
      reference_snapshot: state.reference_snapshot,
      existing_state: null,
    })

    // then
    expect(result).toMatchObject({ kind: "skipped" })
  })

  test("rejects fields that belong to later attempt phases", () => {
    // given
    const fixture = createWorkflowStateFixture()
    const prepared = fixture.dispatch_attempts[0]
    const attempts = [
      { ...prepared, child_session_id: "too-early" },
      { ...prepared, phase: "SESSION_CREATED", child_session_id: "child", raw_output: "too-early" },
      { ...prepared, phase: "PROMPT_SENT", child_session_id: "child", output_hash: "a".repeat(64) },
      { ...prepared, phase: "COMPLETED", child_session_id: "child", raw_output: "missing receipt" },
    ]

    // when
    const results = attempts.map((attempt) => WorkflowStateV1Schema.safeParse({
      ...fixture,
      stage_history: [],
      dispatch_attempts: [attempt],
    }))

    // then
    expect(results.every((result) => !result.success)).toBe(true)
  })
})
