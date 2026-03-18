import { describe, expect, test } from "bun:test"

import type { FrozenArtifacts } from "../../openmath/types"
import { renderStudentSolutionMarkdown } from "./student-solution-markdown"
import { renderTeacherSolutionMarkdown } from "./teacher-solution-markdown"

function createArtifacts(): FrozenArtifacts {
  return {
    reference_solution: "x=1",
    hint_ladder: {
      L1_nudge: "n",
      L2_key_theorem: "t",
      L3_skeleton: ["s1"],
      L4_full_solution: "x=1",
      __orchestrator_state: { secret: "do-not-leak" },
    },
    grading_rubric: {
      premises_check: ["p"],
      logical_steps: ["l"],
      common_pitfalls: ["c"],
      key_theorem: "k",
      key_technique: "m",
      __orchestrator_state: { secret: "do-not-leak" },
    },
    variant_problem: "solve x+1=2",
    review_certificate: {
      artifact_version: "v1",
      review_round: 1,
      timestamp: "1970-01-01T00:00:00.000Z",
      verdict: "[CORRECT]",
    },
  }
}

describe("openmath export original problem rendering", () => {
  test("renders original problem in both student and teacher exports", () => {
    const artifacts = createArtifacts()
    const originalProblemText = "Given: x+1=2\nFind x"

    const student = renderStudentSolutionMarkdown(artifacts, { originalProblemText })
    const teacher = renderTeacherSolutionMarkdown(artifacts, { originalProblemText })

    expect(student).toContain("## Original problem")
    expect(student).toContain(originalProblemText)
    expect(student.indexOf("## Original problem")).toBeLessThan(student.indexOf("## Hint ladder"))

    expect(teacher).toContain("## Original problem")
    expect(teacher).toContain(originalProblemText)
    expect(teacher.indexOf("## Original problem")).toBeLessThan(teacher.indexOf("## Variant problem"))

    expect(student).not.toContain("__orchestrator_state")
    expect(teacher).not.toContain("__orchestrator_state")
    expect(student).not.toContain("do-not-leak")
    expect(teacher).not.toContain("do-not-leak")
  })

  test("omits the section gracefully when original_problem_text is absent", () => {
    const artifacts = createArtifacts()

    const student = renderStudentSolutionMarkdown(artifacts)
    const teacher = renderTeacherSolutionMarkdown(artifacts)

    expect(student).not.toContain("## Original problem")
    expect(teacher).not.toContain("## Original problem")
  })
})
