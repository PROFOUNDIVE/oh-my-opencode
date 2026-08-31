import { hashCertificationSummary } from "../state/summary"
import { buildCertificationSummary } from "../state/build-certification-summary"
import type { ResearchCertificationStateV1 } from "../state/schema"
import { evaluateCertificationEligibility } from "./eligibility"
import { certificationFailure, certificationSuccess } from "./transition-result"
import type { CertificationTransitionEvent, CertificationTransitionResult } from "./types"

type CompleteEvent = Extract<CertificationTransitionEvent, { readonly type: "COMPLETE" }>

export function reduceCompleteCertification(
  state: ResearchCertificationStateV1,
  event: CompleteEvent,
): CertificationTransitionResult {
  if (state.status !== "READY" || state.phase !== "WITNESS_VERIFICATION") {
    return certificationFailure(state, "ILLEGAL_TRANSITION", "Completion requires ready witness verification phase")
  }
  const eligibility = evaluateCertificationEligibility({ state, profile: event.profile })
  const graph = state.graphs.at(-1)
  if (!eligibility.completion_eligible || graph === undefined) {
    return certificationFailure(state, "VALIDATION_ERROR", "Certification terminal work is incomplete")
  }
  const revision = state.certification_revision + 1
  const summary = buildCertificationSummary({ state, graph, certification_revision: revision })
  return certificationSuccess(state, {
    ...state,
    certification_revision: revision,
    phase: "COMPLETE",
    status: "COMPLETE",
    summary,
    finalization: {
      completed_at_revision: revision,
      graph_sha256: graph.graph_sha256,
      summary_sha256: hashCertificationSummary(summary),
    },
  })
}
