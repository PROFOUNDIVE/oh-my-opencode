import type { OpenMathSessionState } from "./types"

export function createInitialOpenMathSessionState(
  sessionId: string,
  hintBudget = 3,
  maxReviewRounds = 3
): OpenMathSessionState {
  return {
    session_id: sessionId,
    artifact_state: "DRAFT",
    artifact_version: 1,
    review_round: 1,
    max_review_rounds: maxReviewRounds,
    hint_budget_state: {
      hints_used: 0,
      hint_budget: hintBudget,
    },
    frozen_artifacts: null,
  }
}
