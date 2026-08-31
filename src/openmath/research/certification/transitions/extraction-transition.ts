import type { ResearchCertificationStateV1 } from "../state/schema"
import { completeCertificationOperation } from "./operation-jobs"
import { certificationFailure, certificationSuccess } from "./transition-result"
import type { CertificationTransitionEvent, CertificationTransitionResult } from "./types"

type ExtractionEvent = Extract<CertificationTransitionEvent, { readonly type: "COMMIT_EXTRACTION" }>

export function reduceCommitCertificationExtraction(
  state: ResearchCertificationStateV1,
  event: ExtractionEvent,
): CertificationTransitionResult {
  if (state.phase !== "EXTRACTION") return certificationFailure(state, "ILLEGAL_TRANSITION", "Extraction commit requires extraction phase")
  if (JSON.stringify(event.graph.artifact) !== JSON.stringify(state.selected_artifact)) {
    return certificationFailure(state, "STALE_ARTIFACT", "Extraction graph artifact is stale")
  }
  const completion = completeCertificationOperation(state, event.completed_jobs)
  if (!completion.ok) return completion.result
  return certificationSuccess(state, {
    ...state,
    certification_revision: completion.revision,
    phase: "COVERAGE_REVIEW",
    status: "READY",
    active_job_ids: [],
    graphs: [...state.graphs, event.graph],
    evidence_receipts: [...state.evidence_receipts, ...event.evidence_receipts],
    job_attempts: completion.job_history,
  })
}
