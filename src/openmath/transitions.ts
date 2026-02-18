import type {
  OpenMathSessionState,
  OpenMathTransitionEvent,
  OpenMathTransitionResult,
  FrozenArtifacts,
} from "./types"

function isProblemSpecificCoachingAllowed(state: OpenMathSessionState): boolean {
  return (
    state.artifact_state === "FROZEN" &&
    state.frozen_artifacts !== null &&
    state.frozen_artifacts.review_certificate.verdict === "[CORRECT]"
  )
}

function withCapabilities(state: OpenMathSessionState): OpenMathTransitionResult {
  const allowed = isProblemSpecificCoachingAllowed(state)
  return {
    state,
    can_problem_specific_coaching: allowed,
    can_verify_with_frozen_reference: allowed,
  }
}

function withUnfrozen(state: OpenMathSessionState): OpenMathSessionState {
  return {
    ...state,
    artifact_state: "UNFROZEN",
    frozen_artifacts: null,
  }
}

function freezeState(state: OpenMathSessionState, frozenArtifacts: FrozenArtifacts): OpenMathSessionState {
  return {
    ...state,
    artifact_state: "FROZEN",
    frozen_artifacts: frozenArtifacts,
  }
}

export function applyOpenMathTransition(
  current: OpenMathSessionState,
  event: OpenMathTransitionEvent
): OpenMathTransitionResult {
  if (event.type === "SOLVE_SUBMITTED") {
    return withCapabilities({
      ...current,
      artifact_state: "DRAFT",
      review_round: 1,
      frozen_artifacts: null,
    })
  }

  if (event.type === "REVIEW_REPORTED") {
    if (event.verdict === "[CORRECT]") {
      if (!event.frozen_artifacts) {
        return withCapabilities(withUnfrozen(current))
      }
      return withCapabilities(freezeState(current, event.frozen_artifacts))
    }

    if (event.verdict === "[INCONCLUSIVE]") {
      return withCapabilities(withUnfrozen(current))
    }

    const nextRound = current.review_round + 1
    if (nextRound > current.max_review_rounds) {
      return withCapabilities(withUnfrozen({ ...current, review_round: nextRound }))
    }

    return withCapabilities({
      ...current,
      artifact_state: "DRAFT",
      review_round: nextRound,
      frozen_artifacts: null,
    })
  }

  if (event.type === "POST_FREEZE_MUTATION") {
    if (current.artifact_state !== "FROZEN") {
      return withCapabilities(current)
    }

    return withCapabilities({
      ...current,
      artifact_state: "DRAFT",
      artifact_version: current.artifact_version + 1,
      review_round: 1,
      frozen_artifacts: null,
    })
  }

  if (!isProblemSpecificCoachingAllowed(current)) {
    return withCapabilities(current)
  }

  const nextHintsUsed = current.hint_budget_state.hints_used + 1
  return withCapabilities({
    ...current,
    hint_budget_state: {
      ...current.hint_budget_state,
      hints_used: nextHintsUsed,
    },
  })
}
