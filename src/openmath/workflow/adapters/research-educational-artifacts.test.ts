import { describe, expect, test } from "bun:test"

import { adaptWorkflowOutput } from "./adapter-dispatch"

const REFERENCE_SOLUTION = "Exact approved proof."

function educationalArtifacts(referenceSolution = REFERENCE_SOLUTION): string {
  return JSON.stringify({
    reference_solution: referenceSolution,
    hint_ladder: {
      L1_nudge: "Start from the defining property.",
      L2_key_theorem: "Apply the defining theorem.",
      L3_skeleton: ["Identify the hypotheses", "Apply the theorem", "Conclude"],
      L4_full_solution: "@REFERENCE_SOLUTION",
    },
    grading_rubric: {
      premises_check: ["States every hypothesis"],
      logical_steps: ["Applies the theorem correctly"],
      common_pitfalls: ["Dropping a hypothesis"],
      key_theorem: "The defining theorem",
      key_technique: "Direct application",
    },
    variant_problem: "Prove the analogous statement for a finite family.",
  })
}

describe("research educational workflow adapters", () => {
  test("accepts pedagogical derivatives when the approved reference is exact", () => {
    const result = adaptWorkflowOutput({
      adapter: "research_educational_artifacts",
      raw_output: educationalArtifacts(),
      fixed_reference_solution: REFERENCE_SOLUTION,
    })

    expect(result.ok).toBe(true)
    if (!result.ok || result.kind !== "legacy_json_artifacts") throw new TypeError("Expected educational artifacts")
    expect(result.artifacts.reference_solution).toBe(REFERENCE_SOLUTION)
  })

  test("rejects an attempted mutation of the approved reference", () => {
    const result = adaptWorkflowOutput({
      adapter: "research_educational_artifacts",
      raw_output: educationalArtifacts("Silently repaired proof."),
      fixed_reference_solution: REFERENCE_SOLUTION,
    })

    expect(result).toMatchObject({
      ok: false,
      error: { code: "REFERENCE_SOLUTION_MUTATED" },
    })
  })

  test("rejects malformed pedagogical derivatives", () => {
    const result = adaptWorkflowOutput({
      adapter: "research_educational_artifacts",
      raw_output: JSON.stringify({ reference_solution: REFERENCE_SOLUTION, hint_ladder: {} }),
      fixed_reference_solution: REFERENCE_SOLUTION,
    })

    expect(result).toMatchObject({
      ok: false,
      error: { code: "INVALID_RESEARCH_EDUCATIONAL_ARTIFACTS" },
    })
  })

  test("surfaces a mathematical source defect without authorizing revision", () => {
    const result = adaptWorkflowOutput({
      adapter: "research_educational_review_json",
      raw_output: JSON.stringify({
        verdict: "SOURCE_DEFECT",
        blocking_issues: ["The immutable proof uses an invalid implication."],
        checks_performed: ["reference_solution_consistency"],
      }),
    })

    expect(result.ok).toBe(true)
    if (!result.ok || result.kind !== "review") throw new TypeError("Expected educational review")
    expect(result.review.verdict).toBe("INCONCLUSIVE")
    expect(result.review.source_defect).toBe(true)
  })

  test("rejects malformed pedagogical review output", () => {
    const result = adaptWorkflowOutput({
      adapter: "research_educational_review_json",
      raw_output: JSON.stringify({ verdict: "PASS", checks_performed: [] }),
    })

    expect(result).toMatchObject({
      ok: false,
      error: { code: "INVALID_RESEARCH_EDUCATIONAL_REVIEW" },
    })
  })

  test("rejects PASS when any required independent check is missing", () => {
    // given
    const rawOutput = JSON.stringify({
      verdict: "PASS",
      blocking_issues: [],
      checks_performed: ["reference_solution_consistency", "hint_progression", "rubric_fidelity", "variant_validity"],
    })

    // when
    const result = adaptWorkflowOutput({ adapter: "research_educational_review_json", raw_output: rawOutput })

    // then
    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_RESEARCH_EDUCATIONAL_REVIEW" } })
  })
})
