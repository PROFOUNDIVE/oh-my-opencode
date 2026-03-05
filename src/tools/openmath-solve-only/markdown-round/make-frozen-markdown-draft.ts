import type { FrozenArtifacts } from "../../../openmath/types"

import { parseOpenMathArtifactsMarkdown } from "../../../openmath/artifacts-markdown/parse"
import { hashOpenMathArtifactsMarkdown } from "../../../openmath/artifacts-markdown/hash"

function attachMarkdownOrchestratorState(args: {
  hint_ladder: Record<string, unknown>
  artifacts_markdown: string
  artifacts_hash: string
}): Record<string, unknown> {
  return {
    ...args.hint_ladder,
    __orchestrator_state: {
      artifacts_format: "markdown",
      artifacts_markdown: args.artifacts_markdown,
      artifacts_hash: args.artifacts_hash,
    },
  }
}

export function makeFrozenMarkdownDraft(args: {
  artifacts_markdown: string
  artifactVersion: number
  reviewRound: number
}):
  | { ok: true; artifacts_markdown: string; artifacts_hash: string; draft: FrozenArtifacts }
  | { ok: false; error_code: "ARTIFACTS_PARSE_ERROR"; message: string } {
  const parsed = parseOpenMathArtifactsMarkdown(args.artifacts_markdown)
  if (!parsed.ok) {
    return { ok: false, error_code: "ARTIFACTS_PARSE_ERROR", message: parsed.error.message }
  }

  const artifactsMarkdown = parsed.normalizedMarkdown
  const artifactsHash = hashOpenMathArtifactsMarkdown(artifactsMarkdown)

  const draft: FrozenArtifacts = {
    reference_solution: parsed.draft.reference_solution,
    hint_ladder: attachMarkdownOrchestratorState({
      hint_ladder: parsed.draft.hint_ladder as any,
      artifacts_markdown: artifactsMarkdown,
      artifacts_hash: artifactsHash,
    }),
    grading_rubric: parsed.draft.grading_rubric as any,
    variant_problem: parsed.draft.variant_problem,
    review_certificate: {
      artifact_version: `v${args.artifactVersion}`,
      review_round: args.reviewRound,
      timestamp: new Date(0).toISOString(),
      verdict: "[INCONCLUSIVE]",
      notes: "DRAFT",
    },
  }

  return { ok: true, artifacts_markdown: artifactsMarkdown, artifacts_hash: artifactsHash, draft }
}
