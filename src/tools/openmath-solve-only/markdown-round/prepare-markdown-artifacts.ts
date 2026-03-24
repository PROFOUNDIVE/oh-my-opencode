import type { OpencodeClient, ToolContextWithMetadata } from "../../delegate-task/types"
import type { FrozenArtifacts } from "../../../openmath/types"

import type { OpenMathToolConfig } from "../tool-config"
import { regenerateMarkdownArtifacts } from "./regenerate-markdown-artifacts"
import { applySolverMarkdownPatch } from "./apply-solver-markdown-patch"

export async function prepareMarkdownArtifacts(args: {
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
      artifacts_markdown: string
      artifacts_hash: string
      draft: FrozenArtifacts
      patch_failure: null | { error_code: string; section_id?: string }
    }
  | {
      ok: false
      error_code: string
      message: string
      stage?: "strip" | "candidate_scan" | "parse" | "schema"
      source?: "solver" | "patch"
    }
> {
  const shouldUsePatch = args.round > 1 && (args.useSolverPatch ?? true)
  const shouldRegenerate = args.round === 1 || !shouldUsePatch

  if (shouldRegenerate) {
    const regenerated = await regenerateMarkdownArtifacts({
      client: args.client,
      directory: args.directory,
      ctx: args.ctx,
      problemId: args.problemId,
      round: args.round,
      solveInput: args.solveInput,
      artifactVersion: args.artifactVersion,
    })
    if (!regenerated.ok) return regenerated
    return { ...regenerated, patch_failure: null }
  }

  if (!args.baseArtifacts) {
    return {
      ok: false,
      error_code: "MISSING_BASE_ARTIFACTS",
      message: "Round > 1 requires base artifacts_markdown/artifacts_hash for patching",
      source: "patch",
    }
  }

  return applySolverMarkdownPatch({
    client: args.client,
    directory: args.directory,
    ctx: args.ctx,
    config: args.config,
    problemId: args.problemId,
    problemText: args.problemText,
    round: args.round,
    artifactVersion: args.artifactVersion,
    textbook_markdown: args.textbook_markdown,
    baseArtifacts: args.baseArtifacts,
  })
}
