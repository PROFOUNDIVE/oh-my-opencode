import type { OpencodeClient, ToolContextWithMetadata } from "../delegate-task/types"
import type { FrozenArtifacts, ReviewVerdict } from "../../openmath/types"

import { runSyncSubagentText } from "./run-sync-subagent"
import { buildJsonPrompt, safeJsonParse } from "./prompt"
import { ReviewerJsonOutputSchema, SolverArtifactsSchema } from "./subagent-output-schemas"

export async function runJsonRound(args: {
  client: OpencodeClient
  directory: string
  ctx: ToolContextWithMetadata
  problemId: string
  problemText: string
  round: number
  artifactVersion: number
  textbook_markdown?: string
  solveInput: Record<string, unknown>
}): Promise<
  | {
      ok: true
      draft: FrozenArtifacts
      verdict: ReviewVerdict
      certificate: { artifact_version: string; review_round: number; timestamp: string; notes?: string } | null
    }
  | { ok: false; error_code: string; message: string }
> {
  const solverOut = await runSyncSubagentText({
    client: args.client,
    directory: args.directory,
    parentSessionID: args.ctx.sessionID,
    ctx: args.ctx,
    agentToUse: "solver",
    description: `OpenMath solve-only: solve ${args.problemId} (round ${args.round})`,
    prompt: buildJsonPrompt(args.solveInput),
    excludeReasoningParts: true,
  })

  const parsed = solverOut.ok ? safeJsonParse(solverOut.text) : null
  const artifacts = parsed ? SolverArtifactsSchema.safeParse(parsed) : null
  if (!solverOut.ok || !artifacts || !artifacts.success) {
    return {
      ok: false,
      error_code: solverOut.ok ? "SOLVER_OUTPUT_INVALID" : "SOLVER_FAILED",
      message: solverOut.ok ? "Solver did not return valid JSON artifacts" : solverOut.error,
    }
  }

  const draft: FrozenArtifacts = {
    ...artifacts.data,
    review_certificate: {
      artifact_version: `v${args.artifactVersion}`,
      review_round: args.round,
      timestamp: new Date(0).toISOString(),
      verdict: "[INCONCLUSIVE]",
      notes: "DRAFT",
    },
  }

  const reviewerOut = await runSyncSubagentText({
    client: args.client,
    directory: args.directory,
    parentSessionID: args.ctx.sessionID,
    ctx: args.ctx,
    agentToUse: "reference-reviewer",
    description: `OpenMath solve-only: review ${args.problemId} (round ${args.round})`,
    prompt: buildJsonPrompt({
      problem: args.problemText,
      reference_solution_draft: draft.reference_solution,
      hint_ladder_draft: draft.hint_ladder,
      grading_rubric_draft: draft.grading_rubric,
      textbook_markdown: args.textbook_markdown ?? null,
      review_round: args.round,
    }),
    excludeReasoningParts: true,
  })

  const reviewerParsed = reviewerOut.ok ? safeJsonParse(reviewerOut.text) : null
  const out = reviewerParsed ? ReviewerJsonOutputSchema.safeParse(reviewerParsed) : null
  if (!out || !out.success) {
    return { ok: true, draft, verdict: "[ERROR]", certificate: null }
  }

  return {
    ok: true,
    draft,
    verdict: out.data.verdict,
    certificate: out.data.certificate,
  }
}
