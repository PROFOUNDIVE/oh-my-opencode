import type { z } from "zod"

import type { CertificationAggregateInvariantInput } from "./aggregate-invariant-input"

export function validateCertificationJobsAndEvidence(state: CertificationAggregateInvariantInput, context: z.RefinementCtx): void {
  const jobs = validateJobs(state, context)
  validateActiveJobs(state, jobs, context)
  validateCommittedResults(state, jobs, context)
  validateEvidence(state, jobs, context)
}

function validateJobs(state: CertificationAggregateInvariantInput, context: z.RefinementCtx) {
  const jobs = new Map<string, CertificationAggregateInvariantInput["job_attempts"][number]>()
  for (const [index, job] of state.job_attempts.entries()) {
    if (jobs.has(job.job_id)) addIssue(context, ["job_attempts", index, "job_id"], "Certification job IDs must be unique")
    if (job.certification_id !== state.certification_id || job.generation_id !== state.generation_id || job.campaign_id !== state.campaign_id) addIssue(context, ["job_attempts", index], "Job must bind certification identity")
    if (job.certification_profile_sha256 !== state.certification_profile_sha256 || job.reference_sha256 !== state.reference_sha256) addIssue(context, ["job_attempts", index], "Job must bind frozen profile and references")
    if (job.target.artifact_sha256 !== state.selected_artifact.artifact_sha256) addIssue(context, ["job_attempts", index, "target", "artifact_sha256"], "Job must bind selected artifact")
    if ("graph_sha256" in job.target) validateJobGraphTarget(state, job.target, context, index)
    jobs.set(job.job_id, job)
  }
  return jobs
}

function validateJobGraphTarget(
  state: CertificationAggregateInvariantInput,
  target: Extract<CertificationAggregateInvariantInput["job_attempts"][number]["target"], { readonly graph_sha256: string }>,
  context: z.RefinementCtx,
  index: number,
): void {
  const graph = state.graphs.find((candidate) => candidate.graph_sha256 === target.graph_sha256)
  if (graph === undefined) addIssue(context, ["job_attempts", index, "target", "graph_sha256"], "Job graph must exist")
  if (target.kind === "ATTACK" || target.kind === "WITNESS") {
    const node = graph?.nodes.find((candidate) => candidate.obligation_id === target.obligation_id)
    if (node?.node_sha256 !== target.node_sha256) addIssue(context, ["job_attempts", index, "target", "node_sha256"], "Job node must match graph")
  }
  if (target.kind === "WITNESS") {
    const attack = state.attack_attempts.find((attempt) => attempt.attack_attempt_id === target.attack_attempt_id)
    if (attack?.outcome !== "COUNTEREXAMPLE_FOUND" || attack.witness_sha256 !== target.witness_sha256
      || attack.obligation_id !== target.obligation_id || attack.node_sha256 !== target.node_sha256
      || attack.graph_sha256 !== target.graph_sha256 || attack.artifact_sha256 !== target.artifact_sha256) {
      addIssue(context, ["job_attempts", index, "target", "attack_attempt_id"], "Witness job must bind exact found attack identity")
    }
  }
}

function validateActiveJobs(
  state: CertificationAggregateInvariantInput,
  jobs: ReadonlyMap<string, CertificationAggregateInvariantInput["job_attempts"][number]>,
  context: z.RefinementCtx,
): void {
  if (new Set(state.active_job_ids).size !== state.active_job_ids.length) addIssue(context, ["active_job_ids"], "Active job IDs must be unique")
  const expected = state.job_attempts.filter((job) => job.phase !== "COMMITTED").map((job) => job.job_id).sort()
  const actual = [...state.active_job_ids].sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected) || actual.some((id) => !jobs.has(id))) addIssue(context, ["active_job_ids"], "Active IDs must equal every uncommitted job")
}

function validateCommittedResults(
  state: CertificationAggregateInvariantInput,
  jobs: ReadonlyMap<string, CertificationAggregateInvariantInput["job_attempts"][number]>,
  context: z.RefinementCtx,
): void {
  const graphHashes: string[] = []
  for (const job of state.job_attempts) {
    if (job.phase === "COMMITTED" && job.receipt.kind === "EXTRACTION") graphHashes.push(job.receipt.graph_sha256)
  }
  if (JSON.stringify(graphHashes) !== JSON.stringify(state.graphs.map((graph) => graph.graph_sha256))) addIssue(context, ["graphs"], "Stored graph order must match committed extraction jobs")
  for (const [index, review] of state.coverage_reviews.entries()) validateCoverageJob(jobs, review, context, index)
  for (const [index, attack] of state.attack_attempts.entries()) validateAttackJob(jobs, attack, context, index)
  for (const [index, witness] of state.witness_verifications.entries()) validateWitnessJob(jobs, witness, context, index)
}

function validateCoverageJob(
  jobs: ReadonlyMap<string, CertificationAggregateInvariantInput["job_attempts"][number]>,
  review: CertificationAggregateInvariantInput["coverage_reviews"][number],
  context: z.RefinementCtx,
  index: number,
): void {
  const job = jobs.get(review.job_id)
  if (job?.phase !== "COMMITTED" || job.receipt.kind !== "COVERAGE" || job.target.kind !== "COVERAGE"
    || job.receipt.coverage_review_id !== review.coverage_review_id || job.target.coverage_review_id !== review.coverage_review_id
    || job.target.coverage_round !== review.coverage_round || job.target.graph_sha256 !== review.graph_sha256
    || job.target.artifact_sha256 !== review.artifact_sha256 || job.phase_revision !== review.certification_revision) {
    addIssue(context, ["coverage_reviews", index], "Coverage result must match exact committed job target")
  }
}

function validateAttackJob(
  jobs: ReadonlyMap<string, CertificationAggregateInvariantInput["job_attempts"][number]>,
  attack: CertificationAggregateInvariantInput["attack_attempts"][number],
  context: z.RefinementCtx,
  index: number,
): void {
  const job = jobs.get(attack.job_id)
  if (job?.phase !== "COMMITTED" || job.receipt.kind !== "ATTACK" || job.target.kind !== "ATTACK"
    || job.receipt.attack_attempt_id !== attack.attack_attempt_id || job.target.attack_attempt_id !== attack.attack_attempt_id
    || job.target.obligation_id !== attack.obligation_id || job.target.node_sha256 !== attack.node_sha256
    || job.target.graph_sha256 !== attack.graph_sha256 || job.target.artifact_sha256 !== attack.artifact_sha256
    || job.target.mode !== attack.mode || job.target.ordinal !== attack.ordinal || job.phase_revision !== attack.certification_revision) {
    addIssue(context, ["attack_attempts", index], "Attack result must match exact committed job target")
  }
}

function validateWitnessJob(
  jobs: ReadonlyMap<string, CertificationAggregateInvariantInput["job_attempts"][number]>,
  witness: CertificationAggregateInvariantInput["witness_verifications"][number],
  context: z.RefinementCtx,
  index: number,
): void {
  const job = jobs.get(witness.job_id)
  const attackJob = [...jobs.values()].find((candidate) => candidate.target.kind === "ATTACK"
    && candidate.target.attack_attempt_id === witness.attack_attempt_id)
  if (job?.phase !== "COMMITTED" || job.receipt.kind !== "WITNESS" || job.target.kind !== "WITNESS"
    || job.receipt.witness_verification_id !== witness.witness_verification_id || job.target.witness_verification_id !== witness.witness_verification_id
    || job.target.attack_attempt_id !== witness.attack_attempt_id || job.target.obligation_id !== witness.obligation_id
    || job.target.node_sha256 !== witness.node_sha256 || job.target.graph_sha256 !== witness.graph_sha256
    || job.target.artifact_sha256 !== witness.artifact_sha256 || job.target.witness_sha256 !== witness.witness_sha256
    || job.phase_revision !== witness.certification_revision) {
    addIssue(context, ["witness_verifications", index], "Witness result must match exact committed job target")
  }
  if (job?.phase === "COMMITTED" && attackJob?.phase === "COMMITTED"
    && job.child_session_id === attackJob.child_session_id) {
    addIssue(context, ["witness_verifications", index], "Witness verification must use a separate child session")
  }
}

function validateEvidence(
  state: CertificationAggregateInvariantInput,
  jobs: ReadonlyMap<string, CertificationAggregateInvariantInput["job_attempts"][number]>,
  context: z.RefinementCtx,
): void {
  const evidenceJobs = new Set<string>()
  for (const [index, evidence] of state.evidence_receipts.entries()) {
    const job = jobs.get(evidence.job_id)
    const expectedGraph = job?.phase === "COMMITTED" && job.receipt.kind !== "ERROR"
      ? job.receipt.kind === "EXTRACTION"
        ? job.receipt.graph_sha256
        : "graph_sha256" in job.target ? job.target.graph_sha256 : null
      : null
    if (evidence.evidence_id !== `evidence-${String(index + 1).padStart(4, "0")}` || evidenceJobs.has(evidence.job_id)) addIssue(context, ["evidence_receipts", index], "Evidence must use canonical IDs and one receipt per job")
    if (job?.phase !== "COMMITTED" || job.receipt.kind === "ERROR" || evidence.job_kind !== job.job_kind || evidence.result_id !== receiptResultId(job.receipt)) addIssue(context, ["evidence_receipts", index], "Evidence must bind committed job result")
    if (evidence.certification_id !== state.certification_id || evidence.generation_id !== state.generation_id || evidence.campaign_id !== state.campaign_id
      || evidence.certification_revision !== job?.phase_revision || evidence.artifact_sha256 !== state.selected_artifact.artifact_sha256
      || evidence.graph_sha256 !== expectedGraph || evidence.prompt_sha256 !== job?.prompt_sha256
      || evidence.input_sha256 !== job?.input_sha256 || evidence.output_sha256 !== (job?.phase === "COMMITTED" ? job.raw_output_sha256 : undefined)
      || evidence.child_session_id !== (job?.phase === "COMMITTED" ? job.child_session_id : undefined)
      || JSON.stringify(evidence.resolved_model) !== JSON.stringify(job?.resolved_model)) addIssue(context, ["evidence_receipts", index], "Evidence must bind exact identity and provenance")
    evidenceJobs.add(evidence.job_id)
  }
  const requiredJobs = state.job_attempts.filter((job) => job.phase === "COMMITTED" && job.receipt.kind !== "ERROR").map((job) => job.job_id)
  if (requiredJobs.some((jobId) => !evidenceJobs.has(jobId))) addIssue(context, ["evidence_receipts"], "Every committed successful job requires evidence")
}

function receiptResultId(receipt: Exclude<Extract<CertificationAggregateInvariantInput["job_attempts"][number], { readonly phase: "COMMITTED" }>['receipt'], { readonly kind: "ERROR" }>): string {
  switch (receipt.kind) {
    case "EXTRACTION": return receipt.graph_sha256
    case "COVERAGE": return receipt.coverage_review_id
    case "ATTACK": return receipt.attack_attempt_id
    case "WITNESS": return receipt.witness_verification_id
    default: return assertNever(receipt)
  }
}

function addIssue(context: z.RefinementCtx, path: readonly (string | number)[], message: string): void {
  context.addIssue({ code: "custom", path: [...path], message })
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected committed certification receipt: ${String(value)}`)
}
