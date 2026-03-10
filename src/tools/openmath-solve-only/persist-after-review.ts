import type { OpenMathStateFilenameMode } from "../../openmath/storage"
import type { FrozenArtifacts, OpenMathSessionState, ReviewVerdict } from "../../openmath/types"

import { writeOpenMathSessionState } from "../../openmath/storage"
import { applyOpenMathTransition } from "../../openmath/transitions"

export function persistAfterReview(args: {
  directory: string
  stateFilenameMode: OpenMathStateFilenameMode
  state: OpenMathSessionState
  draft: FrozenArtifacts
  verdict: ReviewVerdict
}): { ok: true; state: OpenMathSessionState } | { ok: false; message: string } {
  let state: OpenMathSessionState = { ...args.state, artifact_state: "DRAFT", frozen_artifacts: args.draft }
  if (!writeOpenMathSessionState(args.directory, state, args.stateFilenameMode)) {
    return { ok: false, message: "Failed to persist OpenMath draft artifacts" }
  }

  const transitioned = applyOpenMathTransition(state, {
    type: "REVIEW_REPORTED",
    verdict: args.verdict,
    ...(args.verdict === "[CORRECT]" ? { frozen_artifacts: args.draft } : {}),
  })
  state = transitioned.state

  if (args.verdict === "[ERROR]" && state.artifact_state !== "UNFROZEN") {
    state = { ...state, artifact_state: "DRAFT", frozen_artifacts: args.draft }
  }

  if (!writeOpenMathSessionState(args.directory, state, args.stateFilenameMode)) {
    return { ok: false, message: "Failed to persist OpenMath state after review" }
  }

  return { ok: true, state }
}
