import type { OpenMathStateFilenameMode } from "../../openmath/storage"
import type { OpenMathSessionState } from "../../openmath/types"

import { writeOpenMathSessionState } from "../../openmath/storage"
import { applyOpenMathTransition } from "../../openmath/transitions"
import { ensureOpenMathState } from "./state-bootstrap"

export function initializeSolveProblemState(args: {
  directory: string
  rootSessionId: string
  problemId: string
  problemText: string
  maxReviewRounds: number
  stateFilenameMode: OpenMathStateFilenameMode
}):
  | { readonly ok: true; readonly sessionId: string; readonly state: OpenMathSessionState }
  | { readonly ok: false; readonly sessionId: string; readonly errorCode: string; readonly message: string } {
  const sessionId = `${args.rootSessionId}::${args.problemId}`
  const initialized = ensureOpenMathState({
    directory: args.directory,
    sessionId,
    maxReviewRounds: args.maxReviewRounds,
    stateFilenameMode: args.stateFilenameMode,
  })
  if (!initialized.ok) {
    return {
      ok: false,
      sessionId,
      errorCode: initialized.error_code,
      message: "Failed to initialize OpenMath state",
    }
  }

  const state: OpenMathSessionState = {
    ...applyOpenMathTransition(initialized.state, { type: "SOLVE_SUBMITTED" }).state,
    original_problem_text: args.problemText,
  }
  if (!writeOpenMathSessionState(args.directory, state, args.stateFilenameMode)) {
    return {
      ok: false,
      sessionId,
      errorCode: "STATE_WRITE_FAILED",
      message: "Failed to persist OpenMath state after SOLVE_SUBMITTED",
    }
  }
  return { ok: true, sessionId, state }
}

export function consumeReviewBudgetForRoundFailure(args: {
  directory: string
  stateFilenameMode: OpenMathStateFilenameMode
  state: OpenMathSessionState
}): { readonly ok: true; readonly state: OpenMathSessionState } | { readonly ok: false } {
  const transitioned = applyOpenMathTransition(args.state, {
    type: "REVIEW_REPORTED",
    verdict: "[ERROR]",
  }).state
  const state = {
    ...transitioned,
    frozen_artifacts: transitioned.artifact_state === "UNFROZEN" ? null : args.state.frozen_artifacts,
  }
  if (!writeOpenMathSessionState(args.directory, state, args.stateFilenameMode)) return { ok: false }
  return { ok: true, state }
}

export function unfreezeStateAfterRoundFailure(args: {
  directory: string
  stateFilenameMode: OpenMathStateFilenameMode
  state: OpenMathSessionState
}): OpenMathSessionState {
  const state = { ...args.state, artifact_state: "UNFROZEN" as const, frozen_artifacts: null }
  writeOpenMathSessionState(args.directory, state, args.stateFilenameMode)
  return state
}
