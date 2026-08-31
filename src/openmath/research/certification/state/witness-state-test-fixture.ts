import type { z } from "zod"

import { sha256 } from "../../../workflow/stage-runner/sha256"
import { completeCertificationState } from "./complete-state-test-fixture"
import type { CertificationJobReceiptSchema, CertificationJobTargetSchema } from "./jobs"

export function completeCertificationStateWithWitness(outcome: "CONFIRMED" | "REJECTED" | "INCONCLUSIVE") {
  const base = completeCertificationState()
  const graph = base.graphs[0]
  const node = graph?.nodes[0]
  if (graph === undefined || node === undefined) throw new TypeError("Missing complete graph fixture")
  const witnessText = "x = 0 violates the claim."
  const witnessSha256 = sha256(witnessText)
  const attack = {
    attack_attempt_id: "attack-0001",
    certification_revision: 3,
    job_id: "cert-job-attack-0001",
    obligation_id: node.obligation_id,
    node_sha256: node.node_sha256,
    graph_sha256: graph.graph_sha256,
    artifact_sha256: graph.artifact.artifact_sha256,
    mode: "EDGE_CASE" as const,
    ordinal: 1,
    bounds: { coverage_round: 1, mode_ordinal: 1, max_attacks_per_obligation: 1, max_active_certification_jobs: 4 },
    outcome: "COUNTEREXAMPLE_FOUND",
    witness: witnessText,
    witness_sha256: witnessSha256,
  }
  const attackJob = committedJob({
    job_id: attack.job_id,
    job_kind: "ATTACK",
    revision: 3,
    target: {
      kind: "ATTACK",
      attack_attempt_id: attack.attack_attempt_id,
      obligation_id: node.obligation_id,
      node_sha256: node.node_sha256,
      graph_sha256: graph.graph_sha256,
      artifact_sha256: graph.artifact.artifact_sha256,
      mode: attack.mode,
      ordinal: 1,
    },
    receipt: { kind: "ATTACK", attack_attempt_id: attack.attack_attempt_id },
    base,
  })
  const witness = {
    witness_verification_id: "witness-0001",
    certification_revision: 4,
    job_id: "cert-job-witness-0001",
    attack_attempt_id: attack.attack_attempt_id,
    obligation_id: node.obligation_id,
    node_sha256: node.node_sha256,
    graph_sha256: graph.graph_sha256,
    artifact_sha256: graph.artifact.artifact_sha256,
    witness_sha256: witnessSha256,
    outcome,
  }
  const witnessJob = committedJob({
    job_id: witness.job_id,
    job_kind: "WITNESS",
    revision: 4,
    target: {
      kind: "WITNESS",
      witness_verification_id: witness.witness_verification_id,
      attack_attempt_id: attack.attack_attempt_id,
      obligation_id: node.obligation_id,
      node_sha256: node.node_sha256,
      graph_sha256: graph.graph_sha256,
      artifact_sha256: graph.artifact.artifact_sha256,
      witness_sha256: witnessSha256,
    },
    receipt: { kind: "WITNESS", witness_verification_id: witness.witness_verification_id },
    base,
  })
  const summary = {
    ...base.summary,
    certification_revision: 5,
    attack_outcomes: { counterexample_found: 1, no_counterexample_found: 0, invalid_target: 0, inconclusive: 0 },
    witness_outcomes: {
      confirmed: outcome === "CONFIRMED" ? 1 : 0,
      rejected: outcome === "REJECTED" ? 1 : 0,
      inconclusive: outcome === "INCONCLUSIVE" ? 1 : 0,
    },
    uncertainty_count: outcome === "INCONCLUSIVE" ? 1 : 0,
    approval_eligible: outcome === "REJECTED",
  }
  return {
    ...base,
    certification_revision: 5,
    attack_attempts: [attack],
    witness_verifications: [witness],
    evidence_receipts: [
      ...base.evidence_receipts,
      evidence("evidence-0003", attackJob, attack.attack_attempt_id, "LLM_COUNTERARGUMENT", base),
      evidence("evidence-0004", witnessJob, witness.witness_verification_id, "LLM_REVIEW", base),
    ],
    job_attempts: [...base.job_attempts, attackJob, witnessJob],
    summary,
    finalization: {
      completed_at_revision: 5,
      graph_sha256: graph.graph_sha256,
      summary_sha256: sha256(JSON.stringify(summary)),
    },
  }
}

type CompleteState = ReturnType<typeof completeCertificationState>
type FixtureJobTarget = z.input<typeof CertificationJobTargetSchema>
type FixtureJobReceipt = z.input<typeof CertificationJobReceiptSchema>

function committedJob(input: {
  readonly job_id: string
  readonly job_kind: "ATTACK" | "WITNESS"
  readonly revision: number
  readonly target: FixtureJobTarget
  readonly receipt: FixtureJobReceipt
  readonly base: CompleteState
}) {
  return {
    job_id: input.job_id,
    job_kind: input.job_kind,
    certification_id: input.base.certification_id,
    generation_id: input.base.generation_id,
    campaign_id: input.base.campaign_id,
    target: input.target,
    attempt_number: 1,
    prepared_at_revision: input.revision,
    phase_revision: input.revision,
    idempotency_key: sha256(input.job_id),
    role: input.job_kind === "ATTACK" ? "counterexample" : "witness-verifier",
    resolved_model: { providerID: "openai", modelID: "gpt-5" },
    certification_profile_sha256: input.base.certification_profile_sha256,
    prompt_sha256: sha256(`${input.job_id}:prompt`),
    reference_sha256: input.base.reference_sha256,
    input_sha256: sha256(`${input.job_id}:input`),
    child_title: input.job_id,
    phase: "COMMITTED",
    child_session_id: input.job_kind === "ATTACK" ? "ses_certAttack1" : "ses_certWitness1",
    raw_output_sha256: sha256(`${input.job_id}:output`),
    receipt: input.receipt,
  }
}

function evidence(id: string, job: ReturnType<typeof committedJob>, resultId: string, evidenceType: "LLM_REVIEW" | "LLM_COUNTERARGUMENT", base: CompleteState) {
  const graph = base.graphs[0]
  if (graph === undefined) throw new TypeError("Missing complete graph fixture")
  return {
    schema_version: 1,
    evidence_id: id,
    evidence_type: evidenceType,
    certification_id: base.certification_id,
    generation_id: base.generation_id,
    campaign_id: base.campaign_id,
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
