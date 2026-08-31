import { completeCertificationState } from "../state/complete-state-test-fixture"
import { CertificationJobAttemptSchema } from "../state/jobs"
import { ResearchCertificationStateV1Schema, type ResearchCertificationStateV1 } from "../state/schema"
import { reduceCertificationTransition } from "./reduce-transition"

export function certificationOperationFixture() {
  const complete = ResearchCertificationStateV1Schema.parse(completeCertificationState())
  const graph = complete.graphs[0]
  const extractionJob = complete.job_attempts[0]
  const coverageJob = complete.job_attempts[1]
  const extractionEvidence = complete.evidence_receipts[0]
  const coverageEvidence = complete.evidence_receipts[1]
  const coverage = complete.coverage_reviews[0]
  if (graph === undefined || extractionJob === undefined || coverageJob === undefined
    || extractionEvidence === undefined || coverageEvidence === undefined || coverage === undefined) {
    throw new TypeError("Missing operation fixture records")
  }
  const initial = ResearchCertificationStateV1Schema.parse({
    ...complete,
    certification_revision: 0,
    phase: "EXTRACTION",
    status: "READY",
    graphs: [],
    coverage_reviews: [],
    evidence_receipts: [],
    job_attempts: [],
    summary: null,
    finalization: null,
  })
  const extraction = operationRecords(extractionJob, extractionEvidence, 1, 2)
  const coverageRecords = operationRecords(coverageJob, coverageEvidence, 3, 4)
  return {
    initial,
    graph,
    extraction,
    coverage: {
      ...coverageRecords,
      review: { ...coverage, certification_revision: 4 },
    },
  }
}

export function commitFixtureExtraction(fixture: ReturnType<typeof certificationOperationFixture>) {
  const prepared = reduceCertificationTransition(fixture.initial, {
    type: "PREPARE_OPERATION",
    job_attempts: [fixture.extraction.prepared],
    consume_amendment_ids: [],
  }, 0)
  if (!prepared.ok) throw new TypeError("Expected extraction prepare")
  const committed = reduceCertificationTransition(prepared.state, {
    type: "COMMIT_EXTRACTION",
    completed_jobs: [fixture.extraction.completed],
    graph: fixture.graph,
    evidence_receipts: [fixture.extraction.evidence],
  }, 1)
  if (!committed.ok) throw new TypeError("Expected extraction commit")
  return committed.state
}

export function operationRecords(
  committed: ResearchCertificationStateV1["job_attempts"][number],
  evidence: ResearchCertificationStateV1["evidence_receipts"][number],
  preparedRevision: number,
  completedRevision: number,
) {
  if (committed.phase !== "COMMITTED") throw new TypeError("Expected committed fixture job")
  const { child_session_id: childSessionId, raw_output_sha256: rawOutputSha256, receipt, ...base } = committed
  const prepared = CertificationJobAttemptSchema.parse({
    ...base,
    prepared_at_revision: preparedRevision,
    phase_revision: preparedRevision,
    phase: "PREPARED",
  })
  const completed = CertificationJobAttemptSchema.parse({
    ...base,
    prepared_at_revision: preparedRevision,
    phase_revision: completedRevision,
    phase: "COMPLETED",
    child_session_id: childSessionId,
    raw_output_sha256: rawOutputSha256,
    receipt,
  })
  return {
    prepared,
    completed,
    evidence: {
      ...evidence,
      certification_revision: completedRevision,
      output_sha256: rawOutputSha256,
      child_session_id: childSessionId,
    },
  }
}
