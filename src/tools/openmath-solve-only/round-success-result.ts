import type { ReviewVerdict } from "../../openmath/types"

import type { OpenMathSolveOnlyResult } from "./types"

export function createRoundSuccessResult(args: {
  id: string
  sessionId: string
  roundsUsed: number
  verdict: ReviewVerdict
  exported?: { student_path: string; teacher_path: string }
}): OpenMathSolveOnlyResult {
  return {
    id: args.id,
    session_id: args.sessionId,
    rounds_used: args.roundsUsed,
    verdict: args.verdict,
    ...(args.exported ? { exported: args.exported } : {}),
  }
}
