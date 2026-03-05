import { createInitialOpenMathSessionState } from "../../openmath/state"
import { readOpenMathSessionState, writeOpenMathSessionState } from "../../openmath/storage"
import type { OpenMathSessionState } from "../../openmath/types"

export function ensureOpenMathState(args: {
  directory: string
  sessionId: string
  maxReviewRounds: number
}): { ok: true; state: OpenMathSessionState } | { ok: false; error_code: string } {
  const existing = readOpenMathSessionState(args.directory, args.sessionId)
  if (existing) {
    return { ok: true, state: { ...existing, max_review_rounds: args.maxReviewRounds } }
  }

  const initial = createInitialOpenMathSessionState(args.sessionId, 3, args.maxReviewRounds)
  const ok = writeOpenMathSessionState(args.directory, initial)
  if (!ok) {
    return { ok: false, error_code: "STATE_WRITE_FAILED" }
  }

  return { ok: true, state: initial }
}
