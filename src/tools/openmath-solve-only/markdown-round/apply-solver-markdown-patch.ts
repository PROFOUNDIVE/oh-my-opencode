import type { OpencodeClient, ToolContextWithMetadata } from "../../delegate-task/types"
import type { FrozenArtifacts } from "../../../openmath/types"

import { hashOpenMathArtifactsMarkdown } from "../../../openmath/artifacts-markdown/hash"
import { applyOpenMathArtifactsPatch } from "../../../openmath/artifacts-patch/apply"
import { OpenMathArtifactsPatchSetSchema } from "../../../openmath/artifacts-patch/types"

import { runSyncSubagentText } from "../run-sync-subagent"
import { buildJsonPrompt } from "../prompt"
import { makeFrozenMarkdownDraft } from "./make-frozen-markdown-draft"
import type { OpenMathToolConfig } from "../tool-config"
import { extractSchemaValidatedJsonCandidate } from "../json-candidate-extractor"

type PatchFailure = { error_code: string; section_id?: string }

function readSectionId(details: unknown): string | undefined {
  if (!details || typeof details !== "object") return undefined
  if (!("section_id" in details)) return undefined
  const maybe = details.section_id
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
  supplementary_refs?: unknown
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
  | {
      ok: false
      error_code: string
      message: string
      stage?: "strip" | "candidate_scan" | "parse" | "schema"
      source?: "patch"
    }
> {
  const normalizedBase = args.baseArtifacts.artifacts_markdown
  const computedBaseHash = hashOpenMathArtifactsMarkdown(normalizedBase)
  if (computedBaseHash !== args.baseArtifacts.artifacts_hash) {
    return {
      ok: false,
      error_code: "BASE_ARTIFACTS_HASH_MISMATCH",
      message: "Persisted base artifacts_hash does not match computed hash",
      source: "patch",
    }
  }

  const baseDraft = makeFrozenMarkdownDraft({
    artifacts_markdown: normalizedBase,
    artifactVersion: args.artifactVersion,
    reviewRound: args.round,
  })
  if (!baseDraft.ok) {
    return { ok: false, error_code: baseDraft.error_code, message: baseDraft.message, source: "patch" }
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
      supplementary_refs: args.supplementary_refs ?? null,
    }),
    excludeReasoningParts: true,
  })

  if (!patchOut.ok) {
    return {
      ok: true,
      artifacts_markdown: baseDraft.artifacts_markdown,
      artifacts_hash: baseDraft.artifacts_hash,
      draft: baseDraft.draft,
      patch_failure: { error_code: "SOLVER_PATCH_FAILED" },
    }
  }

  const patchSet = extractSchemaValidatedJsonCandidate({
    text: patchOut.text,
    validate: (value) => {
      const parsed = OpenMathArtifactsPatchSetSchema.safeParse(value)
      if (parsed.success) {
        return { success: true as const, data: parsed.data }
      }
      return { success: false as const, message: "Patch output is not schema-valid" }
    },
  })
  if (!patchSet.ok) {
    return {
      ok: true,
      artifacts_markdown: baseDraft.artifacts_markdown,
      artifacts_hash: baseDraft.artifacts_hash,
      draft: baseDraft.draft,
      patch_failure: { error_code: "PATCH_OUTPUT_INVALID" },
    }
  }

  const patchApply = applyOpenMathArtifactsPatch({
    base_markdown: normalizedBase,
    patch_set: patchSet.value,
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
    return { ok: false, error_code: patchedDraft.error_code, message: patchedDraft.message, source: "patch" }
  }

  return {
    ok: true,
    artifacts_markdown: patchedDraft.artifacts_markdown,
    artifacts_hash: patchedDraft.artifacts_hash,
    draft: patchedDraft.draft,
    patch_failure: null,
  }
}
