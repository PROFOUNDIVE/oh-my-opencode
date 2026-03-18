import type { OpencodeClient, ToolContextWithMetadata } from "../../delegate-task/types"
import type { FrozenArtifacts } from "../../../openmath/types"

import { hashOpenMathArtifactsMarkdown } from "../../../openmath/artifacts-markdown/hash"
import { applyOpenMathArtifactsPatch } from "../../../openmath/artifacts-patch/apply"
import { OpenMathArtifactsPatchSetSchema } from "../../../openmath/artifacts-patch/types"

import { runSyncSubagentText } from "../run-sync-subagent"
import { buildJsonPrompt, safeJsonParse } from "../prompt"
import { makeFrozenMarkdownDraft } from "./make-frozen-markdown-draft"
import type { OpenMathToolConfig } from "../tool-config"
import { extractNormalizedJsonPayload } from "../subagent-output-normalizer"

type PatchFailure = { error_code: string; section_id?: string }

function readSectionId(details: unknown): string | undefined {
  if (!details || typeof details !== "object") return undefined
  const maybe = (details as any).section_id
  return typeof maybe === "string" ? maybe : undefined
}

export async function applySolverMarkdownPatch(args: {
  client: OpencodeClient
  directory: string
  ctx: ToolContextWithMetadata
  config: OpenMathToolConfig | undefined
  problemId: string
  problemText: string
  round: number
  artifactVersion: number
  textbook_markdown?: string
  baseArtifacts: {
    artifacts_markdown: string
    artifacts_hash: string
    last_blocking_issues?: unknown
  }
}): Promise<
  | {
      ok: true
      artifacts_markdown: string
      artifacts_hash: string
      draft: FrozenArtifacts
      patch_failure: null | PatchFailure
    }
  | { ok: false; error_code: string; message: string }
> {
  const normalizedBase = args.baseArtifacts.artifacts_markdown
  const computedBaseHash = hashOpenMathArtifactsMarkdown(normalizedBase)
  if (computedBaseHash !== args.baseArtifacts.artifacts_hash) {
    return {
      ok: false,
      error_code: "BASE_ARTIFACTS_HASH_MISMATCH",
      message: "Persisted base artifacts_hash does not match computed hash",
    }
  }

  const baseDraft = makeFrozenMarkdownDraft({
    artifacts_markdown: normalizedBase,
    artifactVersion: args.artifactVersion,
    reviewRound: args.round,
  })
  if (!baseDraft.ok) {
    return { ok: false, error_code: baseDraft.error_code, message: baseDraft.message }
  }

  const patchOut = await runSyncSubagentText({
    client: args.client,
    directory: args.directory,
    parentSessionID: args.ctx.sessionID,
    ctx: args.ctx,
    agentToUse: "solver-markdown-patch",
    description: `OpenMath solve-only: patch ${args.problemId} (round ${args.round})`,
    prompt: buildJsonPrompt({
      problem: args.problemText,
      artifacts_markdown: normalizedBase,
      base_hash: computedBaseHash,
      blocking_issues: args.baseArtifacts.last_blocking_issues ?? [],
      textbook_markdown: args.textbook_markdown ?? null,
      review_round: args.round,
    }),
    excludeReasoningParts: true,
  })

  const normalizedPatchPayload = patchOut.ok ? extractNormalizedJsonPayload(patchOut.text) : null
  const patchParsed = normalizedPatchPayload ? safeJsonParse(normalizedPatchPayload) : null
  const patchSet = patchParsed ? OpenMathArtifactsPatchSetSchema.safeParse(patchParsed) : null
  if (!patchOut.ok || !patchSet || !patchSet.success) {
    return {
      ok: true,
      artifacts_markdown: baseDraft.artifacts_markdown,
      artifacts_hash: baseDraft.artifacts_hash,
      draft: baseDraft.draft,
      patch_failure: { error_code: patchOut.ok ? "PATCH_OUTPUT_INVALID" : "SOLVER_PATCH_FAILED" },
    }
  }

  const patchApply = applyOpenMathArtifactsPatch({
    base_markdown: normalizedBase,
    patch_set: patchSet.data,
    opts: {
      max_ops: args.config?.artifacts?.patch?.max_ops,
      allow_unique_substring_replace: args.config?.artifacts?.patch?.allow_unique_substring_replace,
    },
  })

  if (!patchApply.ok) {
    const sectionId = readSectionId(patchApply.details)
    return {
      ok: true,
      artifacts_markdown: baseDraft.artifacts_markdown,
      artifacts_hash: baseDraft.artifacts_hash,
      draft: baseDraft.draft,
      patch_failure: { error_code: patchApply.error_code, ...(sectionId ? { section_id: sectionId } : {}) },
    }
  }

  const patchedDraft = makeFrozenMarkdownDraft({
    artifacts_markdown: patchApply.markdown,
    artifactVersion: args.artifactVersion,
    reviewRound: args.round,
  })
  if (!patchedDraft.ok) {
    return { ok: false, error_code: patchedDraft.error_code, message: patchedDraft.message }
  }

  return {
    ok: true,
    artifacts_markdown: patchedDraft.artifacts_markdown,
    artifacts_hash: patchedDraft.artifacts_hash,
    draft: patchedDraft.draft,
    patch_failure: null,
  }
}
