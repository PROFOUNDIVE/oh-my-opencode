import { describe, expect, test } from "bun:test"

import { buildReviewStageInput } from "./build-review-stage-input"
import { buildReviseStageInput } from "./build-revise-stage-input"
import { buildSolveStageInput } from "./build-solve-stage-input"
import { runningWorkflowState } from "./test-fixture"

function parsedPrompt(input: { readonly user_prompt: string }) {
  return JSON.parse(input.user_prompt) as Record<string, unknown>
}

describe("workflow stage input builders", () => {
  test("builds SOLVE input from immutable role, references, policy, and checks", () => {
    // given
    const state = runningWorkflowState("SOLVE")

    // when
    const input = buildSolveStageInput({ state, workflow_input: "prove the theorem" })

    // then
    expect(input.system_content).toBe("solve system")
    expect(parsedPrompt(input)).toMatchObject({
      stage: "SOLVE",
      workflow_input: "prove the theorem",
      artifact_input: null,
      amendments: [{ amendment_id: "amendment-1", kind: "required_check" }],
      review_policy: { min_review_rounds: 1, max_review_rounds: 3, required_consecutive_passes: 1 },
      required_checks: ["artifact_correctness", "reference_consistency"],
    })
  })

  test("builds REVIEW input with stage-scoped references and artifact input", () => {
    // given
    const state = runningWorkflowState("REVIEW")

    // when
    const input = buildReviewStageInput({ state, workflow_input: "prove the theorem" })

    // then
    expect(input.system_content).toBe("review system")
    expect(parsedPrompt(input)).toMatchObject({
      stage: "REVIEW",
      artifact_input: { version: 1, content: "# Existing artifact\n" },
      reference_bundle: { stage: "review" },
      amendments: [{ scope: "all_remaining" }],
      required_checks: ["artifact_correctness", "reference_consistency"],
    })
  })

  test("builds REVISE input with the review policy and prior artifact", () => {
    // given
    const state = runningWorkflowState("REVISE")

    // when
    const input = buildReviseStageInput({ state, workflow_input: "prove the theorem" })

    // then
    expect(input.system_content).toBe("revise system")
    expect(parsedPrompt(input)).toMatchObject({
      stage: "REVISE",
      artifact_input: { version: 1, sha256: "c".repeat(64) },
      reference_bundle: { stage: "revise" },
      review_policy: { required_consecutive_passes: 1 },
    })
  })
})
