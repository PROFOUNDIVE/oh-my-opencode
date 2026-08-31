import type { ResearchCertificationStateV1 } from "../state/schema"
import { buildCertificationAttackPlan } from "./scheduling"
import type { CertificationProfileLimits } from "./types"

export type CertificationEligibility = Readonly<{
  readonly completion_eligible: boolean
  readonly approval_eligible: boolean
  readonly reason: "ELIGIBLE" | "STALE_ARTIFACT" | "STALE_GRAPH" | "PROFILE_HASH_MISMATCH" | "INCOMPLETE_COVERAGE" | "INCOMPLETE_ATTACKS" | "INCOMPLETE_WITNESSES"
}>

export function evaluateCertificationEligibility(input: Readonly<{
  readonly state: ResearchCertificationStateV1
  readonly profile: CertificationProfileLimits
  readonly observed_selected_artifact?: ResearchCertificationStateV1["selected_artifact"]
  readonly observed_graph_sha256?: string
}>): CertificationEligibility {
  if (input.profile.certification_profile_sha256 !== input.state.certification_profile_sha256) {
    return ineligible("PROFILE_HASH_MISMATCH")
  }
  if (input.observed_selected_artifact !== undefined
    && JSON.stringify(input.observed_selected_artifact) !== JSON.stringify(input.state.selected_artifact)) {
    return ineligible("STALE_ARTIFACT")
  }
  const graph = input.state.graphs.at(-1)
  if (graph === undefined || graph.nodes.length > input.profile.max_obligations
    || input.observed_graph_sha256 !== undefined && input.observed_graph_sha256 !== graph.graph_sha256) {
    return ineligible("STALE_GRAPH")
  }
  const coverage = input.state.coverage_reviews.at(-1)
  if (coverage?.verdict !== "PASS" || coverage.coverage_round > input.profile.max_coverage_rounds
    || coverage.findings.length > input.profile.max_coverage_findings || coverage.graph_sha256 !== graph.graph_sha256
    || coverage.artifact_sha256 !== graph.artifact.artifact_sha256) {
    return ineligible("INCOMPLETE_COVERAGE")
  }
  const plan = buildCertificationAttackPlan({ graph, coverage, profile: input.profile })
  if (plan.length !== input.state.attack_attempts.length || plan.some((expected, index) => {
    const actual = input.state.attack_attempts[index]
    return actual === undefined || actual.attack_attempt_id !== expected.attack_attempt_id
      || actual.obligation_id !== expected.obligation_id || actual.node_sha256 !== expected.node_sha256
      || actual.graph_sha256 !== expected.graph_sha256 || actual.artifact_sha256 !== expected.artifact_sha256
      || actual.mode !== expected.mode || actual.ordinal !== expected.ordinal
       || JSON.stringify(actual.bounds) !== JSON.stringify(expected.bounds)
  })) return ineligible("INCOMPLETE_ATTACKS")
  const attackJobIds = new Set(input.state.attack_attempts.map((attack) => attack.job_id))
  const attackJobs = input.state.job_attempts.filter((job) => job.job_kind === "ATTACK")
  if (attackJobs.length !== attackJobIds.size || attackJobs.some((job) => !attackJobIds.has(job.job_id))) {
    return ineligible("INCOMPLETE_ATTACKS")
  }
  const found = input.state.attack_attempts.filter((attack) => attack.outcome === "COUNTEREXAMPLE_FOUND")
  const witnesses = new Map(input.state.witness_verifications.map((witness) => [witness.attack_attempt_id, witness]))
  if (found.length !== witnesses.size || found.some((attack) => {
    const witness = witnesses.get(attack.attack_attempt_id)
    return witness === undefined || witness.obligation_id !== attack.obligation_id
       || witness.node_sha256 !== attack.node_sha256 || witness.graph_sha256 !== attack.graph_sha256
       || witness.artifact_sha256 !== attack.artifact_sha256 || witness.witness_sha256 !== attack.witness_sha256
  })) return ineligible("INCOMPLETE_WITNESSES")
  const witnessJobIds = new Set(input.state.witness_verifications.map((witness) => witness.job_id))
  const witnessJobs = input.state.job_attempts.filter((job) => job.job_kind === "WITNESS")
  if (witnessJobs.length !== witnessJobIds.size || witnessJobs.some((job) => !witnessJobIds.has(job.job_id))) {
    return ineligible("INCOMPLETE_WITNESSES")
  }
  return {
    completion_eligible: true,
    approval_eligible: input.state.witness_verifications.every((witness) => witness.outcome === "REJECTED"),
    reason: "ELIGIBLE",
  }
}

function ineligible(reason: Exclude<CertificationEligibility["reason"], "ELIGIBLE">): CertificationEligibility {
  return { completion_eligible: false, approval_eligible: false, reason }
}
