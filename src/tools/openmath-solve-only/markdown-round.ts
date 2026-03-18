import type { OpencodeClient, ToolContextWithMetadata } from "../delegate-task/types"
import type { FrozenArtifacts, ReviewVerdict } from "../../openmath/types"

import type { OpenMathToolConfig } from "./tool-config"
import { prepareMarkdownArtifacts } from "./markdown-round/prepare-markdown-artifacts"
import { reviewMarkdownArtifacts } from "./markdown-round/review-markdown-artifacts"

export async function runMarkdownRound(args: {
  client: OpencodeClient
  directory: string
  ctx: ToolContextWithMetadata
  config: OpenMathToolConfig | undefined
  problemId: string
  problemText: string
  round: number
  artifactVersion: number
  textbook_markdown?: string
  solveInput: Record<string, unknown>
  baseArtifacts?: {
    artifacts_markdown: string
    artifacts_hash: string
    last_blocking_issues?: unknown
  }
  useSolverPatch?: boolean
}): Promise<
  | {
      ok: true
      draft: FrozenArtifacts
      verdict: ReviewVerdict
      certificate: { artifact_version: string; review_round: number; timestamp: string; notes?: string } | null
      blocking_issues: unknown[]
      patch_failure: null | { error_code: string; section_id?: string }
    }
  | { ok: false; error_code: string; message: string }
> {
  const prepared = await prepareMarkdownArtifacts(args)
  if (!prepared.ok) return prepared

  if (prepared.patch_failure) {
    return {
      ok: true,
      draft: prepared.draft,
      verdict: "[ERROR]",
      certificate: null,
      blocking_issues: [],
      patch_failure: prepared.patch_failure,
    }
  }

  const reviewed = await reviewMarkdownArtifacts({
    client: args.client,
    directory: args.directory,
    ctx: args.ctx,
    problemId: args.problemId,
    problemText: args.problemText,
    artifacts_markdown: prepared.artifacts_markdown,
    artifacts_hash: prepared.artifacts_hash,
    textbook_markdown: args.textbook_markdown,
    round: args.round,
  })

  if (!reviewed.ok) {
    if (reviewed.error_code === "REVIEWER_OUTPUT_INVALID") {
      return {
        ok: true,
        draft: prepared.draft,
        verdict: "[ERROR]",
        certificate: null,
        blocking_issues: [],
        patch_failure: null,
      }
    }

    return { ok: false, error_code: reviewed.error_code, message: reviewed.message }
  }

  return {
    ok: true,
    draft: prepared.draft,
    verdict: reviewed.verdict,
    certificate: reviewed.certificate,
    blocking_issues: reviewed.blocking_issues,
    patch_failure: null,
  }
}
