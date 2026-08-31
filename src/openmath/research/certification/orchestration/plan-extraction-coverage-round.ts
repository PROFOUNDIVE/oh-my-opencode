import { sha256 } from "../../../workflow/stage-runner/sha256"
import { prepareCertificationJobAttempt, CertificationJobPreparationError } from "../scheduler/prepare-certification-job-attempt"
import type { ResearchCertificationStateV1 } from "../state/schema"
import type { CertificationOperationPlanResult } from "../application/certification-scheduler-contract"
import { CoverageReviewIdSchema } from "../state/literals"
import {
  amendmentsForOperation,
  buildCoverageRoundPayload,
  buildExtractionRoundPayload,
  CertificationRoundPayloadError,
} from "./extraction-coverage-payload"
import type { ExtractionCoverageRoundContext } from "./extraction-coverage-types"

export type ExtractionCoveragePlanResult =
  | Readonly<{
      readonly ok: true
      readonly job_attempts: readonly ReturnType<typeof prepareCertificationJobAttempt>[]
      readonly consume_amendment_ids: readonly string[]
      readonly payload: ReturnType<typeof buildExtractionRoundPayload> | ReturnType<typeof buildCoverageRoundPayload>
    }>
  | Extract<CertificationOperationPlanResult, { readonly ok: false }>

export function planExtractionCoverageRound(
  state: ResearchCertificationStateV1,
  context: ExtractionCoverageRoundContext,
): ExtractionCoveragePlanResult {
  if (state.status === "RUNNING" || state.status === "COMPLETE" || state.status === "ABORTED") {
    return failure("ILLEGAL_TRANSITION", "Certification state cannot prepare an extraction or coverage round")
  }
  const identityError = contextIdentityError(state, context)
  if (identityError !== null) return identityError
  try {
    switch (state.phase) {
      case "EXTRACTION":
        return extractionPlan(state, context)
      case "COVERAGE_REVIEW":
        return amendmentsForOperation(state, "graph").length > 0
          ? extractionPlan(state, context)
          : coveragePlan(state, context)
      case "COUNTEREXAMPLE_ATTACK":
      case "WITNESS_VERIFICATION":
        return failure("ILLEGAL_TRANSITION", "Extraction and coverage rounds are complete")
      default:
        return assertNever(state)
    }
  } catch (error) {
    if (error instanceof CertificationJobPreparationError || error instanceof CertificationRoundPayloadError) {
      return failure(error.code, error.message)
    }
    if (error instanceof Error) return failure("VALIDATION_ERROR", error.message)
    throw error
  }
}

function extractionPlan(state: ResearchCertificationStateV1, context: ExtractionCoverageRoundContext): ExtractionCoveragePlanResult {
  const coverageRound = state.coverage_reviews.length + 1
  if (coverageRound > context.profile.max_coverage_rounds) {
    return failure("ILLEGAL_TRANSITION", "Coverage round cap is exhausted")
  }
  const payload = buildExtractionRoundPayload(state, context)
  const amendments = payload.amendments.map((amendment) => amendment.amendment_id)
  const job = prepareCertificationJobAttempt({
    state,
    job_id: `cert-job-extraction-${String(coverageRound).padStart(4, "0")}`,
    target: { kind: "EXTRACTION", coverage_round: coverageRound, artifact_sha256: state.selected_artifact.artifact_sha256 },
    role: context.extraction_role.agent,
    resolved_model: context.extraction_role.model,
    prompt_sha256: context.extraction_role.prompt.content_hash,
    input_sha256: sha256(JSON.stringify(payload)),
  })
  return { ok: true, job_attempts: [job], consume_amendment_ids: amendments, payload }
}

function coveragePlan(state: ResearchCertificationStateV1, context: ExtractionCoverageRoundContext): ExtractionCoveragePlanResult {
  const coverageRound = state.coverage_reviews.length + 1
  if (coverageRound > context.profile.max_coverage_rounds) {
    return failure("ILLEGAL_TRANSITION", "Coverage round cap is exhausted")
  }
  const payload = buildCoverageRoundPayload(state, context)
  const amendments = amendmentsForOperation(state, "coverage").map((amendment) => amendment.amendment_id)
  const graph = payload.graph
  const job = prepareCertificationJobAttempt({
    state,
    job_id: `cert-job-coverage-${String(coverageRound).padStart(4, "0")}`,
    target: {
      kind: "COVERAGE",
      coverage_review_id: CoverageReviewIdSchema.parse(`coverage-${String(coverageRound).padStart(4, "0")}`),
      coverage_round: coverageRound,
      artifact_sha256: state.selected_artifact.artifact_sha256,
      graph_sha256: graph.graph_sha256,
    },
    role: context.coverage_role.agent,
    resolved_model: context.coverage_role.model,
    prompt_sha256: context.coverage_role.prompt.content_hash,
    input_sha256: sha256(JSON.stringify(payload)),
  })
  return { ok: true, job_attempts: [job], consume_amendment_ids: amendments, payload }
}

function contextIdentityError(
  state: ResearchCertificationStateV1,
  context: ExtractionCoverageRoundContext,
): Extract<CertificationOperationPlanResult, { readonly ok: false }> | null {
  if (JSON.stringify(state.selected_artifact) !== JSON.stringify(context.sources.artifact)) {
    return failure("STALE_ARTIFACT", "Round context selected artifact is stale")
  }
  if (state.objective_sha256 !== context.sources.objective_sha256
    || state.profile_sha256 !== context.profile_sha256
    || state.reference_sha256 !== context.reference_sha256
    || state.certification_profile_sha256 !== context.profile.certification_profile_sha256) {
    return failure("PROFILE_HASH_MISMATCH", "Round context frozen source identity is stale")
  }
  return null
}

function failure(error_code: Extract<CertificationOperationPlanResult, { readonly ok: false }>["error_code"], message: string) {
  return { ok: false as const, error_code, message }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected extraction/coverage phase: ${String(value)}`)
}
