import type { OpencodeClient, ToolContextWithMetadata } from "../delegate-task/types"
import type { OpenMathSolveOnlyResult } from "./types"
import type { OpenMathToolConfig } from "./tool-config"
import { runLegacyWorkflow } from "./run-legacy-workflow"

export function solveOneProblem(args: {
  directory: string
  client: OpencodeClient
  ctx: ToolContextWithMetadata
  config: OpenMathToolConfig | undefined
  rootSessionId: string
  subject?: string
  chapter_context?: string
  textbook_markdown?: string
  supplementary_refs?: string[]
  problem: { id: string; problem: string; prefix?: string }
  maxReviewRounds: number
  maxConsecutivePatchFailures: number
  autoExport: boolean
  exportDir?: string
}): Promise<OpenMathSolveOnlyResult> {
  return runLegacyWorkflow(args)
}
