import type { z } from "zod"

import type { CertificationAggregateInvariantInput } from "./aggregate-invariant-input"
import { deriveCertificationIdentity } from "./identity"

export function validateCertificationRecords(state: CertificationAggregateInvariantInput, context: z.RefinementCtx): void {
  validateIdentity(state, context)
  const graphs = validateGraphs(state, context)
  validateCoverage(state, graphs, context)
  const attacks = validateAttacks(state, graphs, context)
  validateWitnesses(state, attacks, context)
  validateAmendments(state, attacks, context)
}

function validateIdentity(state: CertificationAggregateInvariantInput, context: z.RefinementCtx): void {
  const expected = deriveCertificationIdentity({
    campaign_id: state.campaign_id,
    selected_artifact_sha256: state.selected_artifact.artifact_sha256,
    certification_profile_sha256: state.certification_profile_sha256,
  })
  if (state.certification_id !== expected.certification_id) addIssue(context, ["certification_id"], "Certification ID must bind exact generation identity")
  if (state.generation_id !== expected.generation_id) addIssue(context, ["generation_id"], "Generation ID must bind exact generation identity")
  if (state.selected_artifact.child_run_id !== `${state.campaign_id}::${state.selected_artifact.candidate_id}`) {
    addIssue(context, ["selected_artifact", "child_run_id"], "Selected child run must bind campaign and candidate")
  }
}

function validateGraphs(state: CertificationAggregateInvariantInput, context: z.RefinementCtx): Map<string, CertificationAggregateInvariantInput["graphs"][number]> {
  const graphs = new Map<string, CertificationAggregateInvariantInput["graphs"][number]>()
  for (const [index, graph] of state.graphs.entries()) {
    if (JSON.stringify(graph.artifact) !== JSON.stringify(state.selected_artifact)) addIssue(context, ["graphs", index, "artifact"], "Every graph must bind selected artifact")
    graphs.set(graph.graph_sha256, graph)
  }
  return graphs
}

function validateCoverage(
  state: CertificationAggregateInvariantInput,
  graphs: ReadonlyMap<string, CertificationAggregateInvariantInput["graphs"][number]>,
  context: z.RefinementCtx,
): Map<string, CertificationAggregateInvariantInput["coverage_reviews"][number]> {
  const reviews = new Map<string, CertificationAggregateInvariantInput["coverage_reviews"][number]>()
  for (const [index, review] of state.coverage_reviews.entries()) {
    const graph = graphs.get(review.graph_sha256)
    if (reviews.has(review.coverage_review_id)) addIssue(context, ["coverage_reviews", index, "coverage_review_id"], "Coverage IDs must be unique")
    if (review.artifact_sha256 !== state.selected_artifact.artifact_sha256 || !graphs.has(review.graph_sha256)) addIssue(context, ["coverage_reviews", index], "Coverage must bind a stored graph and selected artifact")
    for (const finding of review.findings) {
      if (finding.obligation_ids.some((id) => !graph?.nodes.some((node) => node.obligation_id === id))) addIssue(context, ["coverage_reviews", index, "findings"], "Coverage finding obligations must exist in the reviewed graph")
    }
    if (index > 0 && (state.coverage_reviews[index - 1]?.coverage_round ?? 0) >= review.coverage_round) addIssue(context, ["coverage_reviews", index, "coverage_round"], "Coverage rounds must be strictly ordered")
    reviews.set(review.coverage_review_id, review)
  }
  return reviews
}

function validateAttacks(
  state: CertificationAggregateInvariantInput,
  graphs: ReadonlyMap<string, CertificationAggregateInvariantInput["graphs"][number]>,
  context: z.RefinementCtx,
): Map<string, CertificationAggregateInvariantInput["attack_attempts"][number]> {
  const attempts = new Map<string, CertificationAggregateInvariantInput["attack_attempts"][number]>()
  for (const [index, attempt] of state.attack_attempts.entries()) {
    const graph = graphs.get(attempt.graph_sha256)
    const node = graph?.nodes.find((candidate) => candidate.obligation_id === attempt.obligation_id)
    if (attempts.has(attempt.attack_attempt_id)) addIssue(context, ["attack_attempts", index, "attack_attempt_id"], "Attack IDs must be unique")
    if (attempt.ordinal !== index + 1) addIssue(context, ["attack_attempts", index, "ordinal"], "Attack attempts must use canonical ordinal order")
    if (attempt.artifact_sha256 !== state.selected_artifact.artifact_sha256 || node?.node_sha256 !== attempt.node_sha256) addIssue(context, ["attack_attempts", index], "Attack must bind exact graph node and artifact")
    attempts.set(attempt.attack_attempt_id, attempt)
  }
  return attempts
}

function validateWitnesses(
  state: CertificationAggregateInvariantInput,
  attacks: ReadonlyMap<string, CertificationAggregateInvariantInput["attack_attempts"][number]>,
  context: z.RefinementCtx,
): void {
  const witnesses = new Set<string>()
  const witnessedAttacks = new Set<string>()
  for (const [index, witness] of state.witness_verifications.entries()) {
    const attack = attacks.get(witness.attack_attempt_id)
    if (witness.witness_verification_id !== `witness-${String(index + 1).padStart(4, "0")}`) addIssue(context, ["witness_verifications", index, "witness_verification_id"], "Witness verifications must use canonical sequential IDs")
    if (witnesses.has(witness.witness_verification_id) || witnessedAttacks.has(witness.attack_attempt_id)) addIssue(context, ["witness_verifications", index], "Witness and attack bindings must be one-to-one")
    if (attack?.outcome !== "COUNTEREXAMPLE_FOUND" || attack.witness_sha256 !== witness.witness_sha256
      || attack.obligation_id !== witness.obligation_id || attack.node_sha256 !== witness.node_sha256
      || attack.graph_sha256 !== witness.graph_sha256 || attack.artifact_sha256 !== witness.artifact_sha256) {
      addIssue(context, ["witness_verifications", index], "Witness must bind one exact found counterexample")
    }
    witnesses.add(witness.witness_verification_id)
    witnessedAttacks.add(witness.attack_attempt_id)
  }
}

function validateAmendments(
  state: CertificationAggregateInvariantInput,
  attacks: ReadonlyMap<string, unknown>,
  context: z.RefinementCtx,
): void {
  for (const [index, amendment] of state.amendments.entries()) {
    if (amendment.event_type !== "ADDED") continue
    if (amendment.scope.startsWith("counterexample:") && !state.graphs.some((graph) => graph.nodes.some((node) => node.obligation_id === amendment.scope.slice("counterexample:".length)))) addIssue(context, ["amendments", index, "scope"], "Counterexample amendment obligation must exist")
    if (amendment.scope.startsWith("witness:") && !attacks.has(amendment.scope.slice("witness:".length))) addIssue(context, ["amendments", index, "scope"], "Witness amendment attack must exist")
  }
}

function addIssue(context: z.RefinementCtx, path: readonly (string | number)[], message: string): void {
  context.addIssue({ code: "custom", path: [...path], message })
}
