import type { CoverageReview } from "../state/coverage"
import type { CertificationGraph } from "../state/graph"

type CoverageDecisionInput = Readonly<{
  readonly coverage: CoverageReview
  readonly current_graph: CertificationGraph
  readonly max_coverage_rounds: number
}>

export type CoverageTransitionDecision =
  | Readonly<{
      readonly ok: true
      readonly phase: "EXTRACTION" | "COVERAGE_REVIEW" | "COUNTEREXAMPLE_ATTACK"
      readonly status: "READY" | "AWAITING_HUMAN"
      readonly awaiting_reason: "COVERAGE_REVIEW_REQUIRED" | null
    }>
  | Readonly<{ readonly ok: false; readonly error_code: "STALE_ARTIFACT" | "STALE_GRAPH" }>

export function decideCoverageTransition(input: CoverageDecisionInput): CoverageTransitionDecision {
  if (input.coverage.artifact_sha256 !== input.current_graph.artifact.artifact_sha256) {
    return { ok: false, error_code: "STALE_ARTIFACT" }
  }
  if (input.coverage.graph_sha256 !== input.current_graph.graph_sha256) {
    return { ok: false, error_code: "STALE_GRAPH" }
  }
  switch (input.coverage.verdict) {
    case "PASS":
      return { ok: true, phase: "COUNTEREXAMPLE_ATTACK", status: "READY", awaiting_reason: null }
    case "REVISE":
      return input.coverage.coverage_round < input.max_coverage_rounds
        ? { ok: true, phase: "EXTRACTION", status: "READY", awaiting_reason: null }
        : coveragePause()
    case "INCONCLUSIVE":
      return coveragePause()
    default:
      return assertNever(input.coverage.verdict)
  }
}

function coveragePause(): Extract<CoverageTransitionDecision, { readonly ok: true }> {
  return {
    ok: true,
    phase: "COVERAGE_REVIEW",
    status: "AWAITING_HUMAN",
    awaiting_reason: "COVERAGE_REVIEW_REQUIRED",
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected coverage verdict: ${String(value)}`)
}
