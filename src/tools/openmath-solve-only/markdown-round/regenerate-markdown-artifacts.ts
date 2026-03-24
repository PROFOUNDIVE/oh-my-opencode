import type { OpencodeClient, ToolContextWithMetadata } from "../../delegate-task/types"
import type { FrozenArtifacts } from "../../../openmath/types"

import { runSyncSubagentText } from "../run-sync-subagent"
import { buildJsonPrompt } from "../prompt"
import { makeFrozenMarkdownDraft } from "./make-frozen-markdown-draft"
import { extractParserValidatedMarkdownCandidate } from "../markdown-candidate-extractor"

export async function regenerateMarkdownArtifacts(args: {
  client: OpencodeClient
  directory: string
  ctx: ToolContextWithMetadata
  problemId: string
  round: number
  solveInput: Record<string, unknown>
  artifactVersion: number
}): Promise<
  | { ok: true; artifacts_markdown: string; artifacts_hash: string; draft: FrozenArtifacts }
  | {
      ok: false
      error_code: string
      message: string
      stage?: "strip" | "candidate_scan" | "parse" | "schema"
      source?: "solver"
    }
> {
  const solverOut = await runSyncSubagentText({
    client: args.client,
    directory: args.directory,
    parentSessionID: args.ctx.sessionID,
    ctx: args.ctx,
    agentToUse: "solver-markdown",
    description: `OpenMath solve-only: solve ${args.problemId} (round ${args.round})`,
    prompt: buildJsonPrompt(args.solveInput),
    excludeReasoningParts: true,
  })

  if (!solverOut.ok) {
    return {
      ok: false,
      error_code: solverOut.error_code ?? "SOLVER_FAILED",
      message: solverOut.error,
    }
  }

  const extraction = extractParserValidatedMarkdownCandidate(solverOut.text)
  if (!extraction.ok) {
    return {
      ok: false,
      error_code: "ARTIFACTS_PARSE_ERROR",
      message: extraction.message,
      stage: extraction.stage,
      source: "solver",
    }
  }

  const frozen = makeFrozenMarkdownDraft({
    artifacts_markdown: extraction.value,
    artifactVersion: args.artifactVersion,
    reviewRound: args.round,
  })
  if (!frozen.ok) {
    return { ok: false, error_code: frozen.error_code, message: frozen.message }
  }

  return frozen
}
