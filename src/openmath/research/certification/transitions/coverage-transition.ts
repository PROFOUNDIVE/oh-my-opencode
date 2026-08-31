import type { ResearchCertificationStateV1 } from "../state/schema"
import { decideCoverageTransition } from "./coverage-decision"
import { completeCertificationOperation } from "./operation-jobs"
import { certificationFailure, certificationSuccess } from "./transition-result"
import type { CertificationTransitionEvent, CertificationTransitionResult } from "./types"

type CoverageEvent = Extract<CertificationTransitionEvent, { readonly type: "COMMIT_COVERAGE" }>

export function reduceCommitCertificationCoverage(
  state: ResearchCertificationStateV1,
  event: CoverageEvent,
): CertificationTransitionResult {
  if (state.phase !== "COVERAGE_REVIEW") return certificationFailure(state, "ILLEGAL_TRANSITION", "Coverage commit requires coverage phase")
  if (event.profile.certification_profile_sha256 !== state.certification_profile_sha256) {
    return certificationFailure(state, "PROFILE_HASH_MISMATCH", "Coverage profile is stale")
  }
  const graph = state.graphs.at(-1)
  if (graph === undefined) return certificationFailure(state, "STALE_GRAPH", "Coverage requires a current graph")
  const decision = decideCoverageTransition({
    coverage: event.coverage,
    current_graph: graph,
    max_coverage_rounds: event.profile.max_coverage_rounds,
  })
  if (!decision.ok) return certificationFailure(state, decision.error_code, "Coverage target is stale")
  const completion = completeCertificationOperation(state, event.completed_jobs)
  if (!completion.ok) return completion.result
  return certificationSuccess(state, {
    ...state,
    certification_revision: completion.revision,
    phase: decision.phase,
    status: decision.status,
    awaiting_reason: decision.awaiting_reason,
    active_job_ids: [],
    coverage_reviews: [...state.coverage_reviews, event.coverage],
    evidence_receipts: [...state.evidence_receipts, ...event.evidence_receipts],
    job_attempts: completion.job_history,
  })
}
