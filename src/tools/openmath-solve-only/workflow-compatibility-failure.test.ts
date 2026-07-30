import { describe, expect, test } from "bun:test"

import { nextPatchFailureState } from "./markdown-orchestrator-state"
import { shouldConsumeReviewBudgetForMarkdownError } from "./markdown-round-error-policy"

describe("solve-only workflow compatibility failure policy", () => {
  test("keeps the characterized retry budget error policy", () => {
    // given
    const retryable = ["REVIEWER_OUTPUT_INVALID", "ARTIFACTS_PARSE_ERROR"]

    // when
    const consumed = retryable.map(shouldConsumeReviewBudgetForMarkdownError)

    // then
    expect(consumed).toEqual([true, true])
    expect(shouldConsumeReviewBudgetForMarkdownError("AGENT_NOT_FOUND")).toBe(false)
  })

  test("keeps patch failure identity and reset behavior", () => {
    // given
    const first = { error_code: "PATCH_OUTPUT_INVALID", section_id: "reference_solution" }

    // when
    const repeated = nextPatchFailureState({
      prev: nextPatchFailureState({ prev: undefined, failure: first, resetOnSuccess: true }),
      failure: first,
      resetOnSuccess: true,
    })

    // then
    expect(repeated).toEqual({
      consecutive_failures: 2,
      last_error_code: "PATCH_OUTPUT_INVALID",
      last_section_id: "reference_solution",
    })
    expect(nextPatchFailureState({ prev: repeated, failure: null, resetOnSuccess: true })).toEqual({ consecutive_failures: 0 })
  })
})
