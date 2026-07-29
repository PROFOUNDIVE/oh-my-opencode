import { LegacyFrozenArtifactsSchema } from "./contracts"
import { parseOpenMathArtifactsMarkdown } from "../../artifacts-markdown/parse"
import type { OpenMathSessionState } from "../../types"
import type { WorkflowStateV1 } from "./schema"

export type LegacyProjectionResult =
  | { readonly kind: "projected"; readonly state: OpenMathSessionState }
  | { readonly kind: "error"; readonly error_code: "STORAGE_READ_FAILED"; readonly message: string }

export function projectWorkflowStateToLegacy(state: WorkflowStateV1): LegacyProjectionResult {
  switch (state.legacy_projection.kind) {
    case "none":
      return { kind: "error", error_code: "STORAGE_READ_FAILED", message: "Workflow has no legacy projection" }
    case "solve_only":
      return projectSolveOnlyWorkflowState(state)
  }
}

function projectSolveOnlyWorkflowState(state: WorkflowStateV1): LegacyProjectionResult {
  const frozenArtifacts = parseLegacyFrozenArtifacts(state)
  if (frozenArtifacts.kind === "error") return frozenArtifacts
  const legacy = state.legacy_projection
  if (legacy.kind !== "solve_only") return { kind: "error", error_code: "STORAGE_READ_FAILED", message: "Workflow has no legacy projection" }
  return {
    kind: "projected",
    state: {
      session_id: legacy.session_id,
      ...(legacy.original_problem_text === null ? {} : { original_problem_text: legacy.original_problem_text }),
      artifact_state: legacy.artifact_state,
      artifact_version: state.artifact_version,
      review_round: state.review_round,
      max_review_rounds: legacy.max_review_rounds,
      hint_budget_state: legacy.hint_budget_state,
      frozen_artifacts: frozenArtifacts.artifacts,
    },
  }
}

function parseLegacyFrozenArtifacts(state: WorkflowStateV1):
  | { readonly kind: "parsed"; readonly artifacts: OpenMathSessionState["frozen_artifacts"] }
  | { readonly kind: "error"; readonly error_code: "STORAGE_READ_FAILED"; readonly message: string } {
  if (state.artifact === null) return { kind: "parsed", artifacts: null }
  if (state.artifact.media_type === "text/markdown") {
    return parseMarkdownArtifacts(state)
  }
  try {
    const parsed = LegacyFrozenArtifactsSchema.safeParse(JSON.parse(state.artifact.content))
    if (!parsed.success) {
      return { kind: "error", error_code: "STORAGE_READ_FAILED", message: "Legacy artifact content is invalid" }
    }
    return { kind: "parsed", artifacts: parsed.data }
  } catch {
    return { kind: "error", error_code: "STORAGE_READ_FAILED", message: "Legacy artifact content is not valid JSON" }
  }
}

function parseMarkdownArtifacts(state: WorkflowStateV1):
  | { readonly kind: "parsed"; readonly artifacts: NonNullable<OpenMathSessionState["frozen_artifacts"]> }
  | { readonly kind: "error"; readonly error_code: "STORAGE_READ_FAILED"; readonly message: string } {
  const artifact = state.artifact
  if (artifact === null || artifact.media_type !== "text/markdown") {
    return { kind: "error", error_code: "STORAGE_READ_FAILED", message: "Markdown artifact is missing" }
  }
  const parsed = parseOpenMathArtifactsMarkdown(artifact.content)
  if (!parsed.ok) {
    return { kind: "error", error_code: "STORAGE_READ_FAILED", message: "Legacy markdown artifact content is invalid" }
  }
  const review = state.latest_review
  const verdict = review === null
    ? "[INCONCLUSIVE]" as const
    : review.verdict === "PASS"
      ? "[CORRECT]" as const
      : review.verdict === "REVISE"
        ? "[ERROR]" as const
        : "[INCONCLUSIVE]" as const
  const notes = review?.raw_report ?? "DRAFT"
  return {
    kind: "parsed",
    artifacts: {
      reference_solution: parsed.draft.reference_solution,
      hint_ladder: {
        L1_nudge: parsed.draft.hint_ladder.L1_nudge,
        L2_key_theorem: parsed.draft.hint_ladder.L2_key_theorem,
        L3_skeleton: parsed.draft.hint_ladder.L3_skeleton,
        L4_full_solution: parsed.draft.hint_ladder.L4_full_solution,
        __orchestrator_state: {
          artifacts_format: "markdown",
          artifacts_markdown: parsed.normalizedMarkdown,
          artifacts_hash: artifact.sha256,
        },
      },
      grading_rubric: {
        premises_check: parsed.draft.grading_rubric.premises_check,
        logical_steps: parsed.draft.grading_rubric.logical_steps,
        common_pitfalls: parsed.draft.grading_rubric.common_pitfalls,
        key_theorem: parsed.draft.grading_rubric.key_theorem,
        key_technique: parsed.draft.grading_rubric.key_technique,
      },
      variant_problem: parsed.draft.variant_problem,
      review_certificate: {
        artifact_version: `v${artifact.version}`,
        review_round: review?.round ?? state.review_round,
        timestamp: new Date(0).toISOString(),
        verdict,
        notes,
      },
    },
  }
}
