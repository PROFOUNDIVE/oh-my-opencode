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
      synthetic_error?: {
        error_code: string
        stage?: "strip" | "candidate_scan" | "parse" | "schema"
        source: "reviewer" | "solver" | "patch"
      }
    }
  | {
      ok: false
      error_code: string
      message: string
      synthetic_error?: {
        error_code: string
        stage?: "strip" | "candidate_scan" | "parse" | "schema"
        source: "reviewer" | "solver" | "patch"
      }
    }
> {
  const prepared = await prepareMarkdownArtifacts(args)
  if (!prepared.ok) {
    const syntheticError = prepared.stage
      ? {
          error_code: prepared.error_code,
          ...(prepared.stage ? { stage: prepared.stage } : {}),
          source: prepared.source ?? "solver",
        }
      : undefined

    return {
      ...prepared,
      ...(syntheticError ? { synthetic_error: syntheticError } : {}),
    }
  }

  if (prepared.patch_failure) {
    return {
      ok: true,
      draft: prepared.draft,
      verdict: "[ERROR]",
      certificate: null,
      blocking_issues: [],
      patch_failure: prepared.patch_failure,
      synthetic_error: {
        error_code: prepared.patch_failure.error_code,
        ...(prepared.patch_failure.error_code === "PATCH_OUTPUT_INVALID" ? { stage: "schema" as const } : {}),
        source: "patch",
      },
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
    supplementary_refs: args.solveInput.supplementary_refs,
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
        synthetic_error: {
          error_code: reviewed.error_code,
          ...(reviewed.stage ? { stage: reviewed.stage } : {}),
          source: "reviewer",
        },
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
