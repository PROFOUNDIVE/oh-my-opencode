import type { z } from "zod"

import { sha256 } from "../../../workflow/stage-runner/sha256"
import { completeCertificationState } from "../state/complete-state-test-fixture"
import type { CertificationJobReceiptSchema, CertificationJobTargetSchema } from "../state/jobs"
import { ResearchCertificationStateV1Schema } from "../state/schema"

export const TRANSITION_PROFILE = {
  certification_profile_sha256: "2".repeat(64),
  max_obligations: 8,
  max_coverage_rounds: 2,
  max_coverage_findings: 8,
  allowed_attack_modes: ["EDGE_CASE"],
  max_attacks_per_obligation: 1,
  max_active_certification_jobs: 8,
} as const

export function completeTransitionState(witnessOutcome?: "CONFIRMED" | "REJECTED" | "INCONCLUSIVE") {
  const base = completeCertificationState()
  const graph = base.graphs[0]
  if (graph === undefined) throw new TypeError("Missing transition graph")
  const witnessText = "x = 0 violates the claim."
  const witnessSha256 = sha256(witnessText)
  const attacks = graph.nodes.map((node, index) => ({
    attack_attempt_id: `attack-${String(index + 1).padStart(4, "0")}`,
    certification_revision: 3,
    job_id: `cert-job-attack-${String(index + 1).padStart(4, "0")}`,
    obligation_id: node.obligation_id,
    node_sha256: node.node_sha256,
    graph_sha256: graph.graph_sha256,
    artifact_sha256: graph.artifact.artifact_sha256,
    mode: "EDGE_CASE" as const,
    ordinal: index + 1,
    bounds: {
      coverage_round: 1,
      mode_ordinal: 1,
      max_attacks_per_obligation: 1,
      max_active_certification_jobs: 8,
    },
    outcome: witnessOutcome !== undefined && index === 0 ? "COUNTEREXAMPLE_FOUND" : "NO_COUNTEREXAMPLE_FOUND",
    witness: witnessOutcome !== undefined && index === 0 ? witnessText : null,
    witness_sha256: witnessOutcome !== undefined && index === 0 ? witnessSha256 : null,
  }))
  const attackJobs = attacks.map((attack) => committedJob(base, {
    job_id: attack.job_id,
    job_kind: "ATTACK",
    revision: 3,
    target: {
      kind: "ATTACK",
      attack_attempt_id: attack.attack_attempt_id,
      obligation_id: attack.obligation_id,
      node_sha256: attack.node_sha256,
      graph_sha256: attack.graph_sha256,
      artifact_sha256: attack.artifact_sha256,
      mode: attack.mode,
      ordinal: attack.ordinal,
    },
    receipt: { kind: "ATTACK", attack_attempt_id: attack.attack_attempt_id },
    session: `ses_certAttack${indexToken(attack.ordinal)}`,
  }))
  const witness = witnessOutcome === undefined ? [] : [{
    witness_verification_id: "witness-0001",
    certification_revision: 4,
    job_id: "cert-job-witness-0001",
    attack_attempt_id: attacks[0]?.attack_attempt_id,
    obligation_id: attacks[0]?.obligation_id,
    node_sha256: attacks[0]?.node_sha256,
    graph_sha256: graph.graph_sha256,
    artifact_sha256: graph.artifact.artifact_sha256,
    witness_sha256: witnessSha256,
    outcome: witnessOutcome,
  }]
  const witnessJob = witness[0] === undefined ? [] : [committedJob(base, {
    job_id: witness[0].job_id,
    job_kind: "WITNESS",
    revision: 4,
    target: {
      kind: "WITNESS",
      witness_verification_id: witness[0].witness_verification_id,
      attack_attempt_id: witness[0].attack_attempt_id,
      obligation_id: witness[0].obligation_id,
      node_sha256: witness[0].node_sha256,
      graph_sha256: witness[0].graph_sha256,
      artifact_sha256: witness[0].artifact_sha256,
      witness_sha256: witness[0].witness_sha256,
    },
    receipt: { kind: "WITNESS", witness_verification_id: witness[0].witness_verification_id },
    session: "ses_certWitness1",
  })]
  const addedEvidence = [...attackJobs, ...witnessJob].map((job, index) => ({
    schema_version: 1,
    evidence_id: `evidence-${String(index + 3).padStart(4, "0")}`,
    evidence_type: job.job_kind === "ATTACK" ? "LLM_COUNTERARGUMENT" : "LLM_REVIEW",
    certification_id: base.certification_id,
    generation_id: base.generation_id,
    campaign_id: base.campaign_id,
    certification_revision: job.phase_revision,
    job_id: job.job_id,
    job_kind: job.job_kind,
    artifact_sha256: graph.artifact.artifact_sha256,
    graph_sha256: graph.graph_sha256,
    result_id: job.receipt.kind === "ATTACK" ? job.receipt.attack_attempt_id
      : job.receipt.kind === "WITNESS" ? job.receipt.witness_verification_id : graph.graph_sha256,
    prompt_sha256: job.prompt_sha256,
    input_sha256: job.input_sha256,
    output_sha256: job.raw_output_sha256,
    child_session_id: job.child_session_id,
    resolved_model: job.resolved_model,
  }))
  const completionRevision = witnessOutcome === undefined ? 4 : 5
  const summary = {
    ...base.summary,
    certification_revision: completionRevision,
    attack_outcomes: {
      counterexample_found: witnessOutcome === undefined ? 0 : 1,
      no_counterexample_found: witnessOutcome === undefined ? attacks.length : attacks.length - 1,
      invalid_target: 0,
      inconclusive: 0,
    },
    witness_outcomes: {
      confirmed: witnessOutcome === "CONFIRMED" ? 1 : 0,
      rejected: witnessOutcome === "REJECTED" ? 1 : 0,
      inconclusive: witnessOutcome === "INCONCLUSIVE" ? 1 : 0,
    },
    uncertainty_count: witnessOutcome === "INCONCLUSIVE" ? 1 : 0,
    approval_eligible: witnessOutcome === undefined || witnessOutcome === "REJECTED",
  }
  return ResearchCertificationStateV1Schema.parse({
    ...base,
    certification_revision: completionRevision,
    attack_attempts: attacks,
    witness_verifications: witness,
    evidence_receipts: [...base.evidence_receipts, ...addedEvidence],
    job_attempts: [...base.job_attempts, ...attackJobs, ...witnessJob],
    summary,
    finalization: {
      completed_at_revision: completionRevision,
      graph_sha256: graph.graph_sha256,
      summary_sha256: sha256(JSON.stringify(summary)),
    },
  })
}

function committedJob(base: ReturnType<typeof completeCertificationState>, input: Readonly<{
  readonly job_id: string
  readonly job_kind: "ATTACK" | "WITNESS"
  readonly revision: number
  readonly target: z.input<typeof CertificationJobTargetSchema>
  readonly receipt: z.input<typeof CertificationJobReceiptSchema>
  readonly session: string
}>) {
  return {
    job_id: input.job_id,
    job_kind: input.job_kind,
    certification_id: base.certification_id,
    generation_id: base.generation_id,
    campaign_id: base.campaign_id,
    target: input.target,
    attempt_number: 1,
    prepared_at_revision: input.revision,
    phase_revision: input.revision,
    idempotency_key: sha256(input.job_id),
    role: input.job_kind === "ATTACK" ? "counterexample" : "witness-verifier",
    resolved_model: { providerID: "openai", modelID: "gpt-5" },
    certification_profile_sha256: base.certification_profile_sha256,
    prompt_sha256: sha256(`${input.job_id}:prompt`),
    reference_sha256: base.reference_sha256,
    input_sha256: sha256(`${input.job_id}:input`),
    child_title: input.job_id,
    phase: "COMMITTED",
    child_session_id: input.session,
    raw_output_sha256: sha256(`${input.job_id}:output`),
    receipt: input.receipt,
  }
}

function indexToken(value: number): string {
  return String(value).padStart(2, "0")
}
