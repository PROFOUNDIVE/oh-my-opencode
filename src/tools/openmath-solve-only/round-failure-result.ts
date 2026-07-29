import type { ReviewVerdict } from "../../openmath/types"

import type { OpenMathSolveOnlyResult } from "./types"

export type SyntheticRoundError = {
  readonly error_code: string
  readonly stage?: "strip" | "candidate_scan" | "parse" | "schema"
  readonly source: "reviewer" | "solver" | "patch"
}

export function createRoundFailureResult(args: {
  id: string
  sessionId: string
  roundsUsed: number
  verdict?: ReviewVerdict
  errorCode?: string
  message?: string
  syntheticError?: SyntheticRoundError
  useSyntheticError?: boolean
}): OpenMathSolveOnlyResult {
  const syntheticError = args.useSyntheticError ? args.syntheticError : undefined
  const errorCode = syntheticError?.error_code ?? args.errorCode
  const message = syntheticError
    ? `Synthetic ${syntheticError.source} failure${syntheticError.stage ? ` (${syntheticError.stage})` : ""}`
    : args.message
  return {
    id: args.id,
    session_id: args.sessionId,
    rounds_used: args.roundsUsed,
    ...(args.verdict ? { verdict: args.verdict } : {}),
    ...(errorCode ? { error_code: errorCode } : {}),
    ...(message ? { message } : {}),
  }
}
