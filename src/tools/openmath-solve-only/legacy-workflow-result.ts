import type { WorkflowStateV1 } from "../../openmath/workflow/state"
import type { ToolContextWithMetadata } from "../delegate-task/types"
import { maybeAutoExport } from "./maybe-auto-export"
import type { OpenMathToolConfig } from "./tool-config"
import type { OpenMathSolveOnlyResult } from "./types"

type LegacyWorkflowResultInput = Readonly<{
  readonly directory: string
  readonly config: OpenMathToolConfig | undefined
  readonly ctx: ToolContextWithMetadata
  readonly problem: { readonly id: string; readonly prefix?: string }
  readonly autoExport: boolean
  readonly exportDir?: string
}>

export async function createLegacyWorkflowResult(
  input: LegacyWorkflowResultInput,
  state: WorkflowStateV1,
): Promise<OpenMathSolveOnlyResult> {
  const lastAttempt = state.dispatch_attempts.findLast((attempt) => attempt.phase === "COMMITTED")
  const roundsUsed = Math.max(state.completed_review_rounds, lastAttempt?.review_round ?? 0)
  if (state.status === "PASSED") {
    const exported = await maybeAutoExport({
      directory: input.directory,
      config: input.config,
      ctx: input.ctx,
      sessionId: state.run_id,
      prefix: input.problem.prefix ?? input.problem.id,
      exportDir: input.exportDir,
      enabled: input.autoExport,
    })
    return { id: input.problem.id, session_id: state.run_id, rounds_used: roundsUsed, verdict: "[CORRECT]", ...(exported ? { exported } : {}) }
  }
  const verdict = state.latest_review?.verdict === "INCONCLUSIVE" ? "[INCONCLUSIVE]" as const : "[ERROR]" as const
  const errorAttempt = state.dispatch_attempts.findLast((attempt) => attempt.phase === "COMMITTED" && attempt.receipt.kind === "ERROR")
  const errorCode = errorAttempt?.phase === "COMMITTED" && errorAttempt.receipt.kind === "ERROR"
    ? legacyErrorCode(errorAttempt.stage, errorAttempt.receipt.error_code, errorAttempt.receipt.message)
    : undefined
  return {
    id: input.problem.id,
    session_id: state.run_id,
    rounds_used: roundsUsed,
    verdict,
    ...(errorCode === undefined ? {} : { error_code: errorCode }),
    ...(errorAttempt?.phase === "COMMITTED" && "adapter_error" in errorAttempt.receipt
      ? { message: `Synthetic ${errorAttempt.stage === "SOLVE" ? "solver" : errorAttempt.stage === "REVIEW" ? "reviewer" : "patch"} failure${syntheticStage(errorAttempt.stage, errorAttempt.receipt.adapter_error.code)}` }
      : {}),
  }
}

function syntheticStage(stage: "SOLVE" | "REVIEW" | "REVISE", code: string): string {
  if (stage === "REVIEW" && code === "INVALID_JSON") return " (candidate_scan)"
  if (stage === "REVISE" && code === "INVALID_PATCH_SET") return " (schema)"
  return ""
}

function legacyErrorCode(stage: "SOLVE" | "REVIEW" | "REVISE", code: string, message: string): string {
  if (code === "SUBAGENT_FAILED" && message.toLowerCase().includes("agent \"") && message.toLowerCase().includes("not found")) {
    return "AGENT_NOT_FOUND"
  }
  if (code !== "ADAPTER_OUTPUT_INVALID") return code
  if (stage === "SOLVE") return "ARTIFACTS_PARSE_ERROR"
  if (stage === "REVIEW") return "REVIEWER_OUTPUT_INVALID"
  return "PATCH_OUTPUT_INVALID"
}
