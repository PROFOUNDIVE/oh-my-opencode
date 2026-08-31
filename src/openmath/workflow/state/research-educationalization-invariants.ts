import { createHash } from "node:crypto"

import {
  GENERATE_EDUCATIONAL_ARTIFACTS_PROMPT,
  REVIEW_EDUCATIONAL_ARTIFACTS_PROMPT,
  REVISE_EDUCATIONAL_ARTIFACTS_PROMPT,
} from "../../research/educationalization/educationalization-prompts"
import { calculateReferenceBundleSha256 } from "../../references/renderer"
import { adaptWorkflowOutput } from "../adapters/adapter-dispatch"
import {
  REQUIRED_EDUCATIONAL_REVIEW_CHECKS,
  ResearchEducationalReviewSchema,
} from "../adapters/research-educational-artifacts"
import type { WorkflowStateV1 } from "./schema"

type InvariantIssue = Readonly<{ readonly path: readonly (string | number)[]; readonly message: string }>

export function researchEducationalizationInvariantIssues(state: WorkflowStateV1): readonly InvariantIssue[] {
  const request = state.request_snapshot
  if (request?.kind !== "research_educationalization") return []
  const issues: InvariantIssue[] = []
  const expectedRunId = `research-education-${sha256(`${request.campaign_id}\n${request.dossier_sha256}`)}`
  if (state.run_id !== expectedRunId) issue(issues, ["run_id"], "Research educationalization identity mismatch")
  if (request.selected_artifact.artifact_sha256 !== request.reference_solution_sha256) {
    issue(issues, ["request_snapshot", "selected_artifact", "artifact_sha256"], "Selected artifact does not match the fixed reference")
  }
  validateProfile(state, issues)
  validateReference(state, issues)
  if (state.amendments.length > 0) issue(issues, ["amendments"], "Research educationalization does not permit amendments")
  if (state.legacy_projection.kind !== "none" || state.legacy_source_hash !== null) {
    issue(issues, ["legacy_projection"], "Research educationalization cannot use a legacy projection")
  }
  if (state.artifact !== null) {
    if (sha256(state.artifact.content) !== state.artifact.sha256) issue(issues, ["artifact", "sha256"], "Artifact content hash mismatch")
    if (artifactReferenceSolution(state.artifact.content) !== request.reference_solution) {
      issue(issues, ["artifact", "content"], "Artifact changed the fixed reference solution")
    }
  }
  const parsedReviews = state.review_history.map((review, index) => {
    const parsed = ResearchEducationalReviewSchema.safeParse(parseJson(review.raw_report))
    if (sha256(review.raw_report) !== review.raw_report_sha256) {
      issue(issues, ["review_history", index, "raw_report_sha256"], "Review report hash mismatch")
    }
    if (!parsed.success) {
      issue(issues, ["review_history", index, "raw_report"], "Research review report is malformed")
      return null
    }
    const verdict = parsed.data.verdict === "SOURCE_DEFECT" ? "INCONCLUSIVE" : parsed.data.verdict
    if (verdict !== review.verdict || JSON.stringify(parsed.data.checks_performed) !== JSON.stringify(review.checks_performed)) {
      issue(issues, ["review_history", index], "Review DTO does not match its signed report")
    }
    return parsed.data
  })
  const sourceDefect = parsedReviews.some((review) => review?.verdict === "SOURCE_DEFECT")
  if (sourceDefect) {
    if (state.intervention_satisfied) issue(issues, ["intervention_satisfied"], "Source defects cannot be overridden")
    if (state.status === "PASSED") issue(issues, ["status"], "Source defects permanently prohibit pedagogical PASS")
  }
  if (state.status === "PASSED") {
    validatePedagogicalPass(state, parsedReviews.at(-1) ?? null, request.reference_solution, issues)
  }
  return issues
}

export function validateResearchPedagogicalPass(state: WorkflowStateV1): readonly InvariantIssue[] {
  return researchEducationalizationInvariantIssues(state)
}

function validateProfile(state: WorkflowStateV1, issues: InvariantIssue[]): void {
  const profile = state.profile_snapshot
  const valid = profile.name === "research-educationalization"
    && profile.checkpoint === "none"
    && profile.min_review_rounds === 1
    && profile.required_consecutive_passes === 1
    && profile.solve.agent === "solver"
    && profile.solve.output_adapter === "research_educational_artifacts"
    && profile.solve.prompt.kind === "inline"
    && profile.solve.prompt.content === GENERATE_EDUCATIONAL_ARTIFACTS_PROMPT
    && profile.review.agent === "reference-reviewer"
    && profile.review.output_adapter === "research_educational_review_json"
    && profile.review.prompt.kind === "inline"
    && profile.review.prompt.content === REVIEW_EDUCATIONAL_ARTIFACTS_PROMPT
    && profile.revise.agent === "solver"
    && profile.revise.output_adapter === "research_educational_artifacts"
    && profile.revise.prompt.kind === "inline"
    && profile.revise.prompt.content === REVISE_EDUCATIONAL_ARTIFACTS_PROMPT
  if (!valid) issue(issues, ["profile_snapshot"], "Research educationalization profile is reserved and immutable")
}

function validateReference(state: WorkflowStateV1, issues: InvariantIssue[]): void {
  const request = state.request_snapshot
  if (request?.kind !== "research_educationalization") return
  const reference = state.reference_snapshot.references[0]
  const valid = state.reference_snapshot.references.length === 1
    && reference?.id === "approved-research-reference-solution"
    && reference.role === "authoritative"
    && reference.required
    && reference.content === request.reference_solution
    && reference.sha256 === request.reference_solution_sha256
    && sha256(reference.content) === reference.sha256
    && state.reference_snapshot.sha256 === calculateReferenceBundleSha256(state.reference_snapshot.references)
  if (!valid) issue(issues, ["reference_snapshot"], "Research educationalization reference snapshot is not provenance-bound")
}

function artifactReferenceSolution(content: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(content)
    return typeof parsed === "object" && parsed !== null && "reference_solution" in parsed && typeof parsed.reference_solution === "string"
      ? parsed.reference_solution
      : undefined
  } catch (error) {
    if (error instanceof SyntaxError) return undefined
    throw error
  }
}

function hasEveryRequiredCheck(checks: readonly string[]): boolean {
  return checks.length === REQUIRED_EDUCATIONAL_REVIEW_CHECKS.length
    && REQUIRED_EDUCATIONAL_REVIEW_CHECKS.every((check) => checks.includes(check))
}

function validatePedagogicalPass(
  state: WorkflowStateV1,
  parsedLatest: ReturnType<typeof ResearchEducationalReviewSchema.parse> | null,
  fixedReferenceSolution: string,
  issues: InvariantIssue[],
): void {
  const latest = state.latest_review
  const artifact = state.artifact
  if (latest === null || artifact === null) return
  if (JSON.stringify(latest) !== JSON.stringify(state.review_history.at(-1))) {
    issue(issues, ["latest_review"], "Latest review must equal the final durable review history entry")
  }
  if (parsedLatest?.verdict !== "PASS" || latest.verdict !== "PASS" || !hasEveryRequiredCheck(latest.checks_performed)) {
    issue(issues, ["latest_review"], "Pedagogical PASS requires a complete PASS report")
  }
  if (latest.artifact_input_hash !== artifact.sha256) {
    issue(issues, ["latest_review", "artifact_input_hash"], "Pedagogical PASS reviewed a different artifact")
  }
  const reviewAttempt = state.dispatch_attempts.find((attempt) => (
    attempt.phase === "COMMITTED"
    && attempt.stage === "REVIEW"
    && attempt.child_session_id === latest.session_id
    && attempt.raw_output === latest.raw_report
    && attempt.output_hash === latest.raw_report_sha256
    && attempt.receipt.kind === "REVIEW"
    && JSON.stringify(attempt.receipt.review) === JSON.stringify(latest)
  ))
  if (reviewAttempt === undefined) {
    issue(issues, ["latest_review", "session_id"], "Pedagogical PASS is not bound to a committed REVIEW attempt")
  }
  const artifactAttempt = state.dispatch_attempts.findLast((attempt) => {
    if (attempt.phase !== "COMMITTED" || (attempt.stage !== "SOLVE" && attempt.stage !== "REVISE") || attempt.receipt.kind !== "ARTIFACT") {
      return false
    }
    const adapted = adaptWorkflowOutput({
      adapter: "research_educational_artifacts",
      raw_output: attempt.raw_output,
      fixed_reference_solution: fixedReferenceSolution,
    })
    return attempt.output_hash === sha256(attempt.raw_output)
      && JSON.stringify(attempt.receipt.artifact) === JSON.stringify(artifact)
      && adapted.ok
      && adapted.kind === "legacy_json_artifacts"
      && JSON.stringify(adapted.artifacts) === artifact.content
  })
  if (artifactAttempt === undefined) {
    issue(issues, ["artifact"], "Pedagogical artifact is not bound to a committed SOLVE or REVISE attempt")
  } else if ("child_session_id" in artifactAttempt && artifactAttempt.child_session_id === latest.session_id) {
    issue(issues, ["latest_review", "session_id"], "Pedagogical review must use an independent session")
  }
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch (error) {
    if (error instanceof SyntaxError) return undefined
    throw error
  }
}

function issue(issues: InvariantIssue[], path: readonly (string | number)[], message: string): void {
  issues.push({ path, message })
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}
