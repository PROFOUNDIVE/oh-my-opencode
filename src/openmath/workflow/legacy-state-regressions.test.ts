import { describe, expect, test } from "bun:test"

import { formatOpenMathArtifactsMarkdown } from "../artifacts-markdown/format"
import {
  importLegacySolveOnlyState,
  projectWorkflowStateToLegacy,
  WorkflowStateV1Schema,
} from "./state"
import { createWorkflowStateFixture, frozenArtifacts } from "./state/test-fixture"

function importState(source: object, profile = "legacy-educational-json") {
  const fixture = createWorkflowStateFixture()
  return importLegacySolveOnlyState({
    source_bytes: new TextEncoder().encode(JSON.stringify(source)),
    parent_session_id: "parent",
    legacy_profile_name: profile,
    invocation: "solve_only",
    profile_snapshot: fixture.profile_snapshot,
    reference_snapshot: fixture.reference_snapshot,
    existing_state: null,
  })
}

describe("legacy workflow state regressions", () => {
  test("resumes a retained JSON failed review at REVISE with completed review count from its certificate", () => {
    // given
    const artifacts = frozenArtifacts()
    artifacts.review_certificate.verdict = "[ERROR]"
    artifacts.review_certificate.review_round = 1
    const source = {
      session_id: "legacy::failed-review",
      artifact_state: "DRAFT",
      artifact_version: 1,
      review_round: 2,
      max_review_rounds: 3,
      hint_budget_state: { hints_used: 0, hint_budget: 3 },
      frozen_artifacts: artifacts,
    }

    // when
    const result = importState(source)

    // then
    expect(result.kind).toBe("imported")
    if (result.kind !== "imported") return
    expect(result.state).toMatchObject({
      status: "READY",
      next_stage: "REVISE",
      review_round: 2,
      completed_review_rounds: 1,
      artifact_version: 1,
    })
    expect(result.state.artifact).not.toBeNull()
    expect(result.state.latest_review?.round).toBe(1)
  })

  test("imports and projects recursive public JSON records without shape loss", () => {
    // given
    const artifacts = {
      ...frozenArtifacts(),
      hint_ladder: { custom: [{ nested: true }, null, 3, "text"] },
      grading_rubric: { weights: { proof: 0.75 }, flags: [false, true] },
    }
    const source = {
      session_id: "legacy::nested",
      artifact_state: "FROZEN",
      artifact_version: 1,
      review_round: 1,
      max_review_rounds: 3,
      hint_budget_state: { hints_used: 1, hint_budget: 3 },
      frozen_artifacts: artifacts,
    }

    // when
    const imported = importState(source)
    const projection = imported.kind === "imported" ? projectWorkflowStateToLegacy(imported.state) : imported

    // then
    expect(imported.kind).toBe("imported")
    expect(projection.kind).toBe("projected")
    if (projection.kind !== "projected") return
    expect(projection.state).toEqual(source)
  })

  test("projects canonical markdown into complete educational frozen artifacts", () => {
    // given
    const educational = frozenArtifacts()
    const content = formatOpenMathArtifactsMarkdown({
      reference_solution: educational.reference_solution,
      hint_ladder: {
        L1_nudge: educational.hint_ladder.L1_nudge,
        L2_key_theorem: educational.hint_ladder.L2_key_theorem,
        L3_skeleton: educational.hint_ladder.L3_skeleton,
        L4_full_solution: "@REFERENCE_SOLUTION",
      },
      grading_rubric: educational.grading_rubric,
      variant_problem: educational.variant_problem,
    })
    const state = WorkflowStateV1Schema.parse({
      ...createWorkflowStateFixture(),
      stage_history: [],
      dispatch_attempts: [],
      artifact: { version: 1, media_type: "text/markdown", content, sha256: "d".repeat(64) },
    })

    // when
    const projection = projectWorkflowStateToLegacy(state)

    // then
    expect(projection.kind).toBe("projected")
    if (projection.kind !== "projected") return
    expect(projection.state.frozen_artifacts).toMatchObject({
      reference_solution: educational.reference_solution,
      hint_ladder: {
        L1_nudge: educational.hint_ladder.L1_nudge,
        L2_key_theorem: educational.hint_ladder.L2_key_theorem,
        L3_skeleton: educational.hint_ladder.L3_skeleton,
        L4_full_solution: "@REFERENCE_SOLUTION",
      },
      grading_rubric: educational.grading_rubric,
      variant_problem: educational.variant_problem,
      review_certificate: { artifact_version: "v1", review_round: 1, verdict: "[CORRECT]" },
    })
  })
})
