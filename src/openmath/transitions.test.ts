import { describe, expect, test } from "bun:test"
import { createInitialOpenMathSessionState } from "./state"
import { applyOpenMathTransition } from "./transitions"
import type { FrozenArtifacts } from "./types"

function createFrozenArtifacts(
  reviewRound: number,
  verdict: "[CORRECT]" | "[INCONCLUSIVE]" = "[CORRECT]"
): FrozenArtifacts {
  return {
    reference_solution: "ref",
    hint_ladder: { L1_nudge: "nudge" },
    grading_rubric: { key_theorem: "theorem" },
    variant_problem: "variant",
    review_certificate: {
      artifact_version: "v1",
      review_round: reviewRound,
      timestamp: "2026-01-01T00:00:00.000Z",
      verdict,
    },
  }
}

describe("openmath transitions", () => {
  test("initial state starts in DRAFT with review round 1 and max 3", () => {
    const state = createInitialOpenMathSessionState("ses-1")

    expect(state.artifact_state).toBe("DRAFT")
    expect(state.review_round).toBe(1)
    expect(state.max_review_rounds).toBe(3)
    expect(state.frozen_artifacts).toBeNull()
  })

  test("SOLVE_SUBMITTED resets loop to DRAFT review round 1", () => {
    const state = {
      ...createInitialOpenMathSessionState("ses-1"),
      artifact_state: "UNFROZEN" as const,
      review_round: 3,
    }

    const result = applyOpenMathTransition(state, { type: "SOLVE_SUBMITTED" })

    expect(result.state.artifact_state).toBe("DRAFT")
    expect(result.state.review_round).toBe(1)
    expect(result.state.frozen_artifacts).toBeNull()
  })

  test("[ERROR] advances review round while below cap", () => {
    const state = createInitialOpenMathSessionState("ses-1")

    const result = applyOpenMathTransition(state, {
      type: "REVIEW_REPORTED",
      verdict: "[ERROR]",
    })

    expect(result.state.artifact_state).toBe("DRAFT")
    expect(result.state.review_round).toBe(2)
    expect(result.can_problem_specific_coaching).toBe(false)
  })

  test("review round cap overflow transitions to UNFROZEN fail-closed", () => {
    //#given
    const state = {
      ...createInitialOpenMathSessionState("ses-1"),
      review_round: 3,
      max_review_rounds: 3,
    }

    //#when
    const result = applyOpenMathTransition(state, {
      type: "REVIEW_REPORTED",
      verdict: "[ERROR]",
    })

    //#then
    expect(result.state.artifact_state).toBe("UNFROZEN")
    expect(result.state.review_round).toBe(4)
    expect(result.state.frozen_artifacts).toBeNull()
    expect(result.can_problem_specific_coaching).toBe(false)
    expect(result.can_verify_with_frozen_reference).toBe(false)
  })

  test("[INCONCLUSIVE] transitions to UNFROZEN fail-closed", () => {
    //#given
    const state = {
      ...createInitialOpenMathSessionState("ses-1"),
      artifact_state: "FROZEN" as const,
      review_round: 2,
      frozen_artifacts: createFrozenArtifacts(2),
    }

    //#when
    const result = applyOpenMathTransition(state, {
      type: "REVIEW_REPORTED",
      verdict: "[INCONCLUSIVE]",
    })

    //#then
    expect(result.state.artifact_state).toBe("UNFROZEN")
    expect(result.state.review_round).toBe(2)
    expect(result.state.frozen_artifacts).toBeNull()
    expect(result.can_problem_specific_coaching).toBe(false)
    expect(result.can_verify_with_frozen_reference).toBe(false)
  })

  test("POST_FREEZE_MUTATION keeps state unchanged when artifacts are not frozen", () => {
    //#given
    const state = createInitialOpenMathSessionState("ses-1")

    //#when
    const result = applyOpenMathTransition(state, {
      type: "POST_FREEZE_MUTATION",
      field: "hint_ladder",
    })

    //#then
    expect(result.state).toEqual(state)
    expect(result.can_problem_specific_coaching).toBe(false)
    expect(result.can_verify_with_frozen_reference).toBe(false)
  })

  test("[CORRECT] freezes artifacts and enables coaching/verify", () => {
    const state = createInitialOpenMathSessionState("ses-1")

    const result = applyOpenMathTransition(state, {
      type: "REVIEW_REPORTED",
      verdict: "[CORRECT]",
      frozen_artifacts: createFrozenArtifacts(1),
    })

    expect(result.state.artifact_state).toBe("FROZEN")
    expect(result.state.frozen_artifacts).not.toBeNull()
    expect(result.can_problem_specific_coaching).toBe(true)
    expect(result.can_verify_with_frozen_reference).toBe(true)
  })

  test("post-freeze mutation invalidates freeze and restarts review loop", () => {
    const frozen = applyOpenMathTransition(createInitialOpenMathSessionState("ses-1"), {
      type: "REVIEW_REPORTED",
      verdict: "[CORRECT]",
      frozen_artifacts: createFrozenArtifacts(1),
    })

    const result = applyOpenMathTransition(frozen.state, {
      type: "POST_FREEZE_MUTATION",
      field: "reference_solution",
    })

    expect(result.state.artifact_state).toBe("DRAFT")
    expect(result.state.review_round).toBe(1)
    expect(result.state.artifact_version).toBe(2)
    expect(result.state.frozen_artifacts).toBeNull()
    expect(result.can_problem_specific_coaching).toBe(false)
  })

  test("UNFROZEN blocks coach hint consumption", () => {
    //#given
    const state = {
      ...createInitialOpenMathSessionState("ses-1"),
      artifact_state: "UNFROZEN" as const,
    }

    //#when
    const result = applyOpenMathTransition(state, { type: "COACH_HINT_CONSUMED" })

    //#then
    expect(result.state.hint_budget_state.hints_used).toBe(0)
    expect(result.can_problem_specific_coaching).toBe(false)
    expect(result.can_verify_with_frozen_reference).toBe(false)
  })

  test("coach precondition requires FROZEN plus [CORRECT] review certificate", () => {
    //#given
    const state = {
      ...createInitialOpenMathSessionState("ses-1"),
      artifact_state: "FROZEN" as const,
      frozen_artifacts: createFrozenArtifacts(2, "[INCONCLUSIVE]"),
    }

    //#when
    const result = applyOpenMathTransition(state, { type: "COACH_HINT_CONSUMED" })

    //#then
    expect(result.state.artifact_state).toBe("FROZEN")
    expect(result.state.hint_budget_state.hints_used).toBe(0)
    expect(result.can_problem_specific_coaching).toBe(false)
    expect(result.can_verify_with_frozen_reference).toBe(false)
  })

  test("coach hint consumption escalates ladder usage and reaches reveal threshold at budget", () => {
    //#given
    const frozen = applyOpenMathTransition(createInitialOpenMathSessionState("ses-1"), {
      type: "REVIEW_REPORTED",
      verdict: "[CORRECT]",
      frozen_artifacts: createFrozenArtifacts(1),
    })

    //#when
    const afterFirstHint = applyOpenMathTransition(frozen.state, { type: "COACH_HINT_CONSUMED" })
    const afterSecondHint = applyOpenMathTransition(afterFirstHint.state, {
      type: "COACH_HINT_CONSUMED",
    })
    const afterThirdHint = applyOpenMathTransition(afterSecondHint.state, {
      type: "COACH_HINT_CONSUMED",
    })

    //#then
    expect(afterFirstHint.state.hint_budget_state.hints_used).toBe(1)
    expect(afterSecondHint.state.hint_budget_state.hints_used).toBe(2)
    expect(afterThirdHint.state.hint_budget_state.hints_used).toBe(3)
    expect(afterThirdHint.state.hint_budget_state.hint_budget).toBe(3)
    expect(afterThirdHint.can_problem_specific_coaching).toBe(true)
    expect(afterThirdHint.can_verify_with_frozen_reference).toBe(true)
  })

  test("hint usage can continue past budget to represent explicit full-reveal eligibility", () => {
    //#given
    const frozen = applyOpenMathTransition(createInitialOpenMathSessionState("ses-1"), {
      type: "REVIEW_REPORTED",
      verdict: "[CORRECT]",
      frozen_artifacts: createFrozenArtifacts(1),
    })

    //#when
    const afterFourHints = applyOpenMathTransition(
      applyOpenMathTransition(
        applyOpenMathTransition(applyOpenMathTransition(frozen.state, { type: "COACH_HINT_CONSUMED" }).state, {
          type: "COACH_HINT_CONSUMED",
        }).state,
        {
          type: "COACH_HINT_CONSUMED",
        }
      ).state,
      { type: "COACH_HINT_CONSUMED" }
    )

    //#then
    expect(afterFourHints.state.hint_budget_state.hints_used).toBe(4)
    expect(afterFourHints.state.hint_budget_state.hint_budget).toBe(3)
    expect(afterFourHints.can_problem_specific_coaching).toBe(true)
    expect(afterFourHints.can_verify_with_frozen_reference).toBe(true)
  })
})
