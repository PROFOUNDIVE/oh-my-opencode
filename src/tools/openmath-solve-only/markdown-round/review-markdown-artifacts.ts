import type { OpencodeClient, ToolContextWithMetadata } from "../../delegate-task/types"

import { runSyncSubagentText } from "../run-sync-subagent"
import { buildJsonPrompt } from "../prompt"
import { extractSchemaValidatedJsonCandidate } from "../json-candidate-extractor"
import { ReviewerMarkdownOutputSchema } from "../subagent-output-schemas"

export async function reviewMarkdownArtifacts(args: {
  client: OpencodeClient
  directory: string
  ctx: ToolContextWithMetadata
  problemId: string
  problemText: string
  artifacts_markdown: string
  artifacts_hash: string
  textbook_markdown?: string
  round: number
}): Promise<
  | {
      ok: true
      verdict: "[CORRECT]" | "[ERROR]" | "[INCONCLUSIVE]"
      certificate: { artifact_version: string; review_round: number; timestamp: string; notes?: string } | null
      blocking_issues: unknown[]
    }
  | {
      ok: false
      error_code: string
      message: string
      stage?: "strip" | "candidate_scan" | "parse" | "schema"
      source?: "reviewer"
    }
> {
  function inferErrorCodeFromError(error: string): string {
    const lowered = error.toLowerCase()
    if (lowered.includes('agent "') && lowered.includes("not found")) return "AGENT_NOT_FOUND"
    return "REVIEWER_FAILED"
  }

  const reviewerOut = await runSyncSubagentText({
    client: args.client,
    directory: args.directory,
    parentSessionID: args.ctx.sessionID,
    ctx: args.ctx,
    agentToUse: "reference-reviewer-markdown",
    description: `OpenMath solve-only: review ${args.problemId} (round ${args.round})`,
    prompt: buildJsonPrompt({
      problem: args.problemText,
      artifacts_markdown: args.artifacts_markdown,
      base_hash: args.artifacts_hash,
      textbook_markdown: args.textbook_markdown ?? null,
      review_round: args.round,
    }),
    excludeReasoningParts: true,
  })

  if (!reviewerOut.ok) {
    return {
      ok: false,
      error_code: reviewerOut.error_code ?? inferErrorCodeFromError(reviewerOut.error),
      message: reviewerOut.error,
    }
  }

  const out = extractSchemaValidatedJsonCandidate({
    text: reviewerOut.text,
    validate: (value) => {
      const parsed = ReviewerMarkdownOutputSchema.safeParse(value)
      if (parsed.success) {
        return { success: true as const, data: parsed.data }
      }
      return { success: false as const, message: "Reviewer did not return valid JSON output" }
    },
  })
  if (!out.ok) {
    return {
      ok: false,
      error_code: "REVIEWER_OUTPUT_INVALID",
      message: out.message,
      stage: out.stage,
      source: "reviewer",
    }
  }

  return {
    ok: true,
    verdict: out.value.verdict,
    certificate: out.value.certificate,
    blocking_issues: out.value.blocking_issues,
  }
}
