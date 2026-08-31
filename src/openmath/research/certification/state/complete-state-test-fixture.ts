import type { z } from "zod"

import { sha256 } from "../../../workflow/stage-runner/sha256"
import { deriveCertificationIdentity } from "./identity"
import type { CertificationJobReceiptSchema, CertificationJobTargetSchema } from "./jobs"
import {
  HASH_B,
  HASH_D,
  HASH_E,
  graphSourceContext,
} from "./certification-test-fixture"

export function completeCertificationState() {
  const source = graphSourceContext()
  const graph = source.graph
  const identity = deriveCertificationIdentity({
    campaign_id: "campaign-a",
    selected_artifact_sha256: graph.artifact.artifact_sha256,
    certification_profile_sha256: HASH_B,
  })
  const extractionJob = committedJob({
    job_id: "cert-job-extraction-0001",
    job_kind: "EXTRACTION",
    target: { kind: "EXTRACTION", coverage_round: 1, artifact_sha256: graph.artifact.artifact_sha256 },
    receipt: { kind: "EXTRACTION", graph_sha256: graph.graph_sha256 },
    revision: 1,
    identity,
  })
  const coverage = {
    coverage_review_id: "coverage-0001",
    certification_revision: 2,
    job_id: "cert-job-coverage-0001",
    coverage_round: 1,
    artifact_sha256: graph.artifact.artifact_sha256,
    graph_sha256: graph.graph_sha256,
    verdict: "PASS",
    findings: [],
  }
  const coverageJob = committedJob({
    job_id: coverage.job_id,
    job_kind: "COVERAGE",
    target: {
      kind: "COVERAGE",
      coverage_review_id: coverage.coverage_review_id,
      coverage_round: 1,
      artifact_sha256: graph.artifact.artifact_sha256,
      graph_sha256: graph.graph_sha256,
    },
    receipt: { kind: "COVERAGE", coverage_review_id: coverage.coverage_review_id },
    revision: 2,
    identity,
  })
  const evidenceReceipts = [
    evidence("evidence-0001", extractionJob, graph.graph_sha256, graph, identity),
    evidence("evidence-0002", coverageJob, coverage.coverage_review_id, graph, identity),
  ]
  const summary = {
    schema_version: 1,
    certification_id: identity.certification_id,
    generation_id: identity.generation_id,
    certification_revision: 3,
    artifact_sha256: graph.artifact.artifact_sha256,
    graph_sha256: graph.graph_sha256,
    coverage_verdict: "PASS",
    total_obligation_count: 6,
    required_obligation_count: 6,
    attack_outcomes: { counterexample_found: 0, no_counterexample_found: 0, invalid_target: 0, inconclusive: 0 },
    witness_outcomes: { confirmed: 0, rejected: 0, inconclusive: 0 },
    uncertainty_count: 0,
    approval_eligible: true,
  }
  return {
    schema_version: 1,
    ...identity,
    campaign_id: "campaign-a",
    selected_artifact: graph.artifact,
    objective_sha256: source.sources.objective_sha256,
    profile_sha256: HASH_D,
    reference_sha256: HASH_E,
    certification_profile_sha256: HASH_B,
    certification_revision: 3,
    phase: "COMPLETE",
    status: "COMPLETE",
    awaiting_reason: null,
    abort_requested: false,
    abort_reason: null,
    blocked_reason: null,
    active_job_ids: [],
    graphs: [graph],
    coverage_reviews: [coverage],
    attack_attempts: [],
    witness_verifications: [],
    evidence_receipts: evidenceReceipts,
    amendments: [],
    job_attempts: [extractionJob, coverageJob],
    summary,
    finalization: {
      completed_at_revision: 3,
      graph_sha256: graph.graph_sha256,
      summary_sha256: sha256(JSON.stringify(summary)),
    },
  }
}

type Identity = ReturnType<typeof deriveCertificationIdentity>
type FixtureJobTarget = z.input<typeof CertificationJobTargetSchema>
type FixtureJobReceipt = z.input<typeof CertificationJobReceiptSchema>

function committedJob(input: {
  readonly job_id: string
  readonly job_kind: "EXTRACTION" | "COVERAGE"
  readonly target: FixtureJobTarget
  readonly receipt: FixtureJobReceipt
  readonly revision: number
  readonly identity: Identity
}) {
  return {
    job_id: input.job_id,
    job_kind: input.job_kind,
    ...input.identity,
    campaign_id: "campaign-a",
    target: input.target,
    attempt_number: 1,
    prepared_at_revision: input.revision,
    phase_revision: input.revision,
    idempotency_key: sha256(input.job_id),
    role: input.job_kind === "EXTRACTION" ? "extractor" : "coverage-reviewer",
    resolved_model: { providerID: "openai", modelID: "gpt-5" },
    certification_profile_sha256: HASH_B,
    prompt_sha256: sha256(`${input.job_id}:prompt`),
    reference_sha256: HASH_E,
    input_sha256: sha256(`${input.job_id}:input`),
    child_title: input.job_id,
    phase: "COMMITTED",
    child_session_id: input.job_kind === "EXTRACTION" ? "ses_certExtract1" : "ses_certCoverage1",
    raw_output_sha256: sha256(`${input.job_id}:output`),
    receipt: input.receipt,
  }
}

function evidence(id: string, job: ReturnType<typeof committedJob>, resultId: string, graph: ReturnType<typeof graphSourceContext>["graph"], identity: Identity) {
  return {
    schema_version: 1,
    evidence_id: id,
    evidence_type: "LLM_REVIEW",
    ...identity,
    campaign_id: "campaign-a",
    certification_revision: job.phase_revision,
    job_id: job.job_id,
    job_kind: job.job_kind,
    artifact_sha256: graph.artifact.artifact_sha256,
    graph_sha256: graph.graph_sha256,
    result_id: resultId,
    prompt_sha256: job.prompt_sha256,
    input_sha256: job.input_sha256,
    output_sha256: job.raw_output_sha256,
    child_session_id: job.child_session_id,
    resolved_model: job.resolved_model,
  }
}
