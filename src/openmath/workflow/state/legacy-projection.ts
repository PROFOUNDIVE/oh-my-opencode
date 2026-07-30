import { LegacyFrozenArtifactsSchema } from "./contracts"
import { parseOpenMathArtifactsMarkdown } from "../../artifacts-markdown/parse"
import { hashOpenMathArtifactsMarkdown } from "../../artifacts-markdown/hash"
import type { OpenMathSessionState } from "../../types"
import type { WorkflowStateV1 } from "./schema"
import { SolverArtifactsSchema } from "../../../tools/openmath-solve-only/subagent-output-schemas"

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
  const artifactState = legacyArtifactState(state)
  return {
    kind: "projected",
    state: {
      session_id: legacy.session_id,
      ...(legacy.original_problem_text === null ? {} : { original_problem_text: legacy.original_problem_text }),
      artifact_state: artifactState,
      artifact_version: state.artifact_version,
      review_round: state.review_round,
      max_review_rounds: legacy.max_review_rounds,
      hint_budget_state: legacy.hint_budget_state,
      frozen_artifacts: artifactState === "UNFROZEN" ? null : frozenArtifacts.artifacts,
    },
  }
}

function legacyArtifactState(state: WorkflowStateV1): OpenMathSessionState["artifact_state"] {
  switch (state.status) {
    case "PASSED":
      return "FROZEN"
    case "EXHAUSTED":
    case "ABORTED":
      return "UNFROZEN"
    case "READY":
    case "RUNNING":
    case "AWAITING_HUMAN":
      if (state.awaiting_reason === "INCONCLUSIVE") return "UNFROZEN"
      return state.artifact === null ? legacyProjectionArtifactState(state) : "DRAFT"
    case "BLOCKED":
      return state.dispatch_attempts.some((attempt) => attempt.phase === "COMMITTED" && attempt.receipt.kind === "ERROR")
        ? "UNFROZEN"
        : state.artifact === null ? legacyProjectionArtifactState(state) : "DRAFT"
  }
}

function legacyProjectionArtifactState(state: WorkflowStateV1): OpenMathSessionState["artifact_state"] {
  return state.legacy_projection.kind === "solve_only" ? state.legacy_projection.artifact_state : "DRAFT"
}

function parseLegacyFrozenArtifacts(state: WorkflowStateV1):
  | { readonly kind: "parsed"; readonly artifacts: OpenMathSessionState["frozen_artifacts"] }
  | { readonly kind: "error"; readonly error_code: "STORAGE_READ_FAILED"; readonly message: string } {
  if (state.artifact === null) return { kind: "parsed", artifacts: null }
  if (state.artifact.media_type === "text/markdown") {
    return parseMarkdownArtifacts(state)
  }
  try {
    const content: unknown = JSON.parse(state.artifact.content)
    const parsed = LegacyFrozenArtifactsSchema.safeParse(content)
    if (parsed.success) return { kind: "parsed", artifacts: parsed.data }
    const draft = SolverArtifactsSchema.safeParse(content)
    if (!draft.success) return { kind: "error", error_code: "STORAGE_READ_FAILED", message: "Legacy artifact content is invalid" }
    return { kind: "parsed", artifacts: {
      ...draft.data,
      review_certificate: {
        artifact_version: `v${state.artifact.version}`,
        review_round: state.latest_review?.round ?? state.review_round,
        timestamp: new Date(0).toISOString(),
        verdict: legacyVerdict(state.latest_review?.verdict),
        notes: state.latest_review?.raw_report ?? "DRAFT",
      },
    } }
  } catch {
    return { kind: "error", error_code: "STORAGE_READ_FAILED", message: "Legacy artifact content is not valid JSON" }
  }
}

function legacyVerdict(verdict: "PASS" | "REVISE" | "INCONCLUSIVE" | undefined) {
  if (verdict === "PASS") return "[CORRECT]" as const
  if (verdict === "REVISE") return "[ERROR]" as const
  return "[INCONCLUSIVE]" as const
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
  const reviewMetadata = state.legacy_projection.kind === "solve_only"
    ? state.legacy_projection.review_metadata
    : null
  const verdict = review === null
    ? "[INCONCLUSIVE]" as const
    : review.verdict === "PASS"
      ? "[CORRECT]" as const
      : review.verdict === "REVISE"
        ? "[ERROR]" as const
        : "[INCONCLUSIVE]" as const
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
            artifacts_hash: hashOpenMathArtifactsMarkdown(artifact.content),
            ...legacyMarkdownFallback(state),
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
        artifact_version: reviewMetadata?.certificate.artifact_version ?? `v${artifact.version}`,
        review_round: reviewMetadata?.certificate.review_round ?? review?.round ?? state.review_round,
        timestamp: reviewMetadata?.certificate.timestamp ?? new Date(0).toISOString(),
        verdict,
        ...(reviewMetadata?.certificate.notes === undefined
          ? { notes: review?.raw_report ?? "DRAFT" }
          : { notes: reviewMetadata.certificate.notes }),
      },
    },
  }
}

function legacyMarkdownFallback(state: WorkflowStateV1): Record<string, unknown> {
  if (state.legacy_projection.kind !== "solve_only") return {}
  const reviewMetadata = state.legacy_projection.review_metadata?.blocking_issues === undefined
    ? {}
    : { last_blocking_issues: state.legacy_projection.review_metadata.blocking_issues }
  if (state.legacy_projection.markdown_fallback === null) return reviewMetadata
  const fallback = state.legacy_projection.markdown_fallback
  const patchFailureState = {
    consecutive_failures: fallback.consecutive_failures,
    ...(fallback.last_error_code === null ? {} : { last_error_code: fallback.last_error_code }),
    ...(fallback.last_section_id === null ? {} : { last_section_id: fallback.last_section_id }),
  }
  const lastFailure = fallback.sub_attempt_history.findLast((attempt) => attempt.outcome === "FAILED")
  return {
    ...reviewMetadata,
    max_consecutive_patch_failures: fallback.max_consecutive_patch_failures,
    max_ops: fallback.max_ops,
    allow_unique_substring_replace: fallback.allow_unique_substring_replace,
    patch_failure_state: patchFailureState,
    last_patch_failure: lastFailure === undefined ? null : {
      error_code: lastFailure.error_code,
      ...(lastFailure.section_id === null ? {} : { section_id: lastFailure.section_id }),
    },
    sub_attempt_history: fallback.sub_attempt_history,
  }
}
