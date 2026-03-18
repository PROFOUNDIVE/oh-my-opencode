import { readOpenMathSessionState } from "../../openmath/storage"
import type { FrozenArtifacts } from "../../openmath/types"

export function getFrozenArtifactsOrError(
  directory: string,
  sessionId: string,
):
  | { ok: true; artifacts: FrozenArtifacts; originalProblemText?: string }
  | { ok: false; error_code: string; message: string } {
  const state = readOpenMathSessionState(directory, sessionId)
  if (!state) {
    return { ok: false, error_code: "STATE_NOT_FOUND", message: `OpenMath state not found for session_id=${sessionId}` }
  }

  if (!state.frozen_artifacts) {
    return { ok: false, error_code: "ARTIFACTS_MISSING", message: "OpenMath state has no frozen_artifacts" }
  }

  return {
    ok: true,
    artifacts: state.frozen_artifacts,
    ...(state.original_problem_text !== undefined ? { originalProblemText: state.original_problem_text } : {}),
  }
}
