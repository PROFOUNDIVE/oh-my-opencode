import type { WorkflowStateV1 } from "../state"
import type { WorkflowStage } from "../state/literals"
import type { WorkflowStageInput } from "./stage-input"
import { hashOpenMathArtifactsMarkdown } from "../../artifacts-markdown/hash"

export function buildLegacyStageInput(
  state: WorkflowStateV1,
  stage: WorkflowStage,
): WorkflowStageInput | null {
  if (state.legacy_projection.kind !== "solve_only" || state.request_snapshot?.kind !== "problem") return null
  const request = state.request_snapshot
  const solve = {
    ...(request.subject ? { subject: request.subject } : {}),
    ...(request.chapter_context ? { chapter_context: request.chapter_context } : {}),
    problem: request.problem_text,
    ...(request.textbook_markdown ? { textbook_markdown: request.textbook_markdown } : {}),
    supplementary_refs: request.supplementary_refs ?? null,
  }
  if (
    stage === "SOLVE"
    || state.profile_snapshot.name === "legacy-educational-json" && stage === "REVISE"
    || state.legacy_projection.markdown_fallback?.regenerate_next === true && stage === "REVISE"
  ) {
    return { system_content: undefined, user_prompt: JSON.stringify(solve) }
  }
  const artifact = state.artifact
  if (artifact === null) return null
  if (stage === "REVIEW") {
    const review = artifact.media_type === "text/markdown"
      ? {
          problem: request.problem_text,
          artifacts_markdown: artifact.content,
          base_hash: hashOpenMathArtifactsMarkdown(artifact.content),
          textbook_markdown: request.textbook_markdown ?? null,
          review_round: state.review_round,
          supplementary_refs: request.supplementary_refs ?? null,
        }
      : legacyJsonReviewPayload(state, request.problem_text, request.textbook_markdown, request.supplementary_refs)
    return { system_content: undefined, user_prompt: JSON.stringify(review) }
  }
  return {
    system_content: undefined,
    user_prompt: JSON.stringify({
      problem: request.problem_text,
      artifacts_markdown: artifact.content,
      base_hash: hashOpenMathArtifactsMarkdown(artifact.content),
      blocking_issues: blockingIssues(state.latest_review?.raw_report),
      textbook_markdown: request.textbook_markdown ?? null,
      review_round: state.review_round,
      supplementary_refs: request.supplementary_refs ?? null,
    }),
  }
}

function legacyJsonReviewPayload(
  state: WorkflowStateV1,
  problem: string,
  textbookMarkdown: string | undefined,
  supplementaryRefs: readonly string[] | undefined,
): Record<string, unknown> {
  const artifact = state.artifact
  if (artifact === null) return {}
  const parsed: unknown = JSON.parse(artifact.content)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
  return {
    problem,
    reference_solution_draft: "reference_solution" in parsed ? parsed.reference_solution : null,
    hint_ladder_draft: "hint_ladder" in parsed ? parsed.hint_ladder : null,
    grading_rubric_draft: "grading_rubric" in parsed ? parsed.grading_rubric : null,
    textbook_markdown: textbookMarkdown ?? null,
    review_round: state.review_round,
    supplementary_refs: supplementaryRefs ?? null,
  }
}

function blockingIssues(rawReport: string | undefined): unknown[] {
  if (rawReport === undefined) return []
  try {
    const parsed: unknown = JSON.parse(rawReport)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !("blocking_issues" in parsed)) return []
    return Array.isArray(parsed.blocking_issues) ? parsed.blocking_issues : []
  } catch {
    return []
  }
}
