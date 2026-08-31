import type { z } from "zod"

import type { CertificationAggregateInvariantInput } from "./aggregate-invariant-input"
import { buildCertificationSummary } from "./build-certification-summary"
import { hashCertificationSummary } from "./summary"

export function validateCertificationSummary(state: CertificationAggregateInvariantInput, context: z.RefinementCtx): void {
  if (state.status !== "COMPLETE") return
  const graph = state.graphs[state.graphs.length - 1]
  const coverage = state.coverage_reviews[state.coverage_reviews.length - 1]
  if (graph === undefined || coverage?.verdict !== "PASS" || coverage.graph_sha256 !== graph.graph_sha256) {
    addIssue(context, ["summary"], "Completion requires latest graph coverage PASS")
    return
  }
  const missingWitness = state.attack_attempts.some((attack) => attack.outcome === "COUNTEREXAMPLE_FOUND"
    && !state.witness_verifications.some((witness) => witness.attack_attempt_id === attack.attack_attempt_id))
  if (missingWitness) addIssue(context, ["witness_verifications"], "Every found counterexample requires terminal witness verification")
  const expected = buildCertificationSummary({ state, graph, certification_revision: state.certification_revision })
  if (JSON.stringify(state.summary) !== JSON.stringify(expected)) addIssue(context, ["summary"], "Summary must be derived from exact terminal records")
  if (state.finalization?.completed_at_revision !== state.certification_revision) addIssue(context, ["finalization", "completed_at_revision"], "Finalization revision must equal state revision")
  if (state.finalization?.graph_sha256 !== graph.graph_sha256) addIssue(context, ["finalization", "graph_sha256"], "Finalization must bind latest graph")
  if (state.summary !== null && state.finalization?.summary_sha256 !== hashCertificationSummary(state.summary)) addIssue(context, ["finalization", "summary_sha256"], "Finalization must bind exact summary JSON")
}

function addIssue(context: z.RefinementCtx, path: readonly (string | number)[], message: string): void {
  context.addIssue({ code: "custom", path: [...path], message })
}
