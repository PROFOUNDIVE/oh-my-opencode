import type { CertificationAggregateInvariantInput } from "./aggregate-invariant-input"
import type { CertificationGraph } from "./graph"
import { CertificationSummaryV1Schema, type CertificationSummaryV1 } from "./summary"

type SummaryState = Pick<CertificationAggregateInvariantInput,
  | "certification_id"
  | "generation_id"
  | "selected_artifact"
  | "attack_attempts"
  | "witness_verifications"
>

export function buildCertificationSummary(input: Readonly<{
  readonly state: SummaryState
  readonly graph: CertificationGraph
  readonly certification_revision: number
}>): CertificationSummaryV1 {
  const attackOutcomes = {
    counterexample_found: input.state.attack_attempts.filter((attack) => attack.outcome === "COUNTEREXAMPLE_FOUND").length,
    no_counterexample_found: input.state.attack_attempts.filter((attack) => attack.outcome === "NO_COUNTEREXAMPLE_FOUND").length,
    invalid_target: input.state.attack_attempts.filter((attack) => attack.outcome === "INVALID_TARGET").length,
    inconclusive: input.state.attack_attempts.filter((attack) => attack.outcome === "INCONCLUSIVE").length,
  }
  const witnessOutcomes = {
    confirmed: input.state.witness_verifications.filter((witness) => witness.outcome === "CONFIRMED").length,
    rejected: input.state.witness_verifications.filter((witness) => witness.outcome === "REJECTED").length,
    inconclusive: input.state.witness_verifications.filter((witness) => witness.outcome === "INCONCLUSIVE").length,
  }
  const foundAttackIds = new Set(input.state.attack_attempts
    .filter((attack) => attack.outcome === "COUNTEREXAMPLE_FOUND")
    .map((attack) => attack.attack_attempt_id))
  const approvalEligible = foundAttackIds.size === input.state.witness_verifications.length
    && input.state.witness_verifications.every((witness) => foundAttackIds.has(witness.attack_attempt_id)
      && witness.outcome === "REJECTED")
  return CertificationSummaryV1Schema.parse({
    schema_version: 1,
    certification_id: input.state.certification_id,
    generation_id: input.state.generation_id,
    certification_revision: input.certification_revision,
    artifact_sha256: input.state.selected_artifact.artifact_sha256,
    graph_sha256: input.graph.graph_sha256,
    coverage_verdict: "PASS",
    total_obligation_count: input.graph.nodes.length,
    required_obligation_count: input.graph.nodes.filter((node) => node.required).length,
    attack_outcomes: attackOutcomes,
    witness_outcomes: witnessOutcomes,
    uncertainty_count: attackOutcomes.inconclusive + witnessOutcomes.inconclusive,
    approval_eligible: approvalEligible,
  })
}
