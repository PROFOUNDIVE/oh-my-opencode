import { describe, expect, test } from "bun:test"

import { CertificationGraphSchema } from "../state/graph"
import { mixedGraphFixture } from "../state/certification-test-fixture"
import { CoverageReviewSchema } from "../state/coverage"
import { planBoundedCertificationAttacks } from "../scheduler/attack-planner"
import { adaptCertificationAttackOutput } from "./attack-output-adapter"
import { buildCertificationAttackResult } from "./attack-result-builder"

describe("certification attack output adapter", () => {
  test("parses exactly the four categorical outcomes including invalid target and inconclusive", () => {
    // given
    const context = attackContext()
    const outputs = [
      { outcome: "COUNTEREXAMPLE_FOUND", witness: "x = 0 violates the claimed inequality.", reported_case_count: 1 },
      { outcome: "NO_COUNTEREXAMPLE_FOUND", witness: null, reported_case_count: 500 },
      { outcome: "INVALID_TARGET", witness: null, reported_case_count: null },
      { outcome: "INCONCLUSIVE", witness: null, reported_case_count: null },
    ]

    // when
    const adapted = outputs.map((output) => adaptCertificationAttackOutput(JSON.stringify(output), context))

    // then
    expect(adapted.map((result) => result.ok && result.output.outcome)).toEqual([
      "COUNTEREXAMPLE_FOUND",
      "NO_COUNTEREXAMPLE_FOUND",
      "INVALID_TARGET",
      "INCONCLUSIVE",
    ])
  })

  test("rejects malformed, unknown, numeric, duplicate, and unsupported outcome output", () => {
    // given
    const context = attackContext()
    const invalid = [
      "not-json",
      JSON.stringify({ outcome: "PROVED", witness: null, reported_case_count: null }),
      JSON.stringify({ outcome: 1, witness: null, reported_case_count: null }),
      JSON.stringify({ outcome: "INCONCLUSIVE", witness: null, reported_case_count: null, score: 0.5 }),
      '{"outcome":"INCONCLUSIVE","outcome":"INVALID_TARGET","witness":null,"reported_case_count":null}',
    ]

    // when
    const results = invalid.map((raw) => adaptCertificationAttackOutput(raw, context))

    // then
    expect(results.every((result) => !result.ok)).toBe(true)
    expect(results[0]).toMatchObject({ ok: false, error: { code: "INVALID_JSON" } })
    expect(results[4]).toMatchObject({ ok: false, error: { code: "DUPLICATE_FIELD" } })
  })

  test("rejects stale target hashes and model-selected evidence or machine execution claims", () => {
    // given
    const context = attackContext()
    const negative = { outcome: "NO_COUNTEREXAMPLE_FOUND", witness: null, reported_case_count: 1000 }
    const forbidden = [
      { ...negative, evidence_type: "FINITE_EXHAUSTIVE_SEARCH" },
      { ...negative, exhaustive: true },
      { ...negative, executable_check: "python search.py" },
      { ...negative, shell_command: "python search.py" },
      { ...negative, network_request: "https://example.test" },
    ]

    // when
    const stale = adaptCertificationAttackOutput(JSON.stringify(negative), {
      ...context,
      target: { ...context.target, graph_sha256: "f".repeat(64) },
    })
    const rejected = forbidden.map((output) => adaptCertificationAttackOutput(JSON.stringify(output), context))

    // then
    expect(stale).toMatchObject({ ok: false, error: { code: "STALE_TARGET" } })
    expect(rejected.every((result) => !result.ok)).toBe(true)
  })

  test("derives only LLM counterargument evidence and never trusts reported case counts as bounds", () => {
    // given
    const context = attackContext()
    const adapted = adaptCertificationAttackOutput(JSON.stringify({
      outcome: "NO_COUNTEREXAMPLE_FOUND",
      witness: null,
      reported_case_count: 999999,
    }), context)
    if (!adapted.ok) throw new TypeError("Expected bounded negative output")

    // when
    const result = buildCertificationAttackResult({
      output: adapted.output,
      expected_attempt: context.expected_attempt,
      target: context.target,
      certification_revision: 3,
      job_id: "cert-job-attack-0001",
    })

    // then
    expect(result.evidence_type).toBe("LLM_COUNTERARGUMENT")
    expect(result.attack.outcome).toBe("NO_COUNTEREXAMPLE_FOUND")
    expect(result.attack.bounds).toEqual(context.expected_attempt.bounds)
    expect(result.untrusted_metadata).toEqual({ reported_case_count: 999999 })
    expect(JSON.stringify(result)).not.toContain("FINITE_EXHAUSTIVE_SEARCH")
  })
})

function attackContext() {
  const graph = CertificationGraphSchema.parse(mixedGraphFixture())
  const planned = planBoundedCertificationAttacks({
    graph,
    coverage: CoverageReviewSchema.parse({
      coverage_review_id: "coverage-0001",
      certification_revision: 2,
      job_id: "cert-job-coverage-0001",
      coverage_round: 1,
      artifact_sha256: graph.artifact.artifact_sha256,
      graph_sha256: graph.graph_sha256,
      verdict: "PASS",
      findings: [],
    }),
    profile: {
      allowed_attack_modes: ["EDGE_CASE"],
      max_attacks_per_obligation: 1,
      max_active_certification_jobs: 2,
    },
    active_targets: [],
    terminal_attempts: [],
  })
  if (!planned.ok || planned.plan[0] === undefined) throw new TypeError("Expected attack plan")
  const expectedAttempt = planned.plan[0]
  return {
    expected_attempt: expectedAttempt,
    target: {
      kind: "ATTACK" as const,
      attack_attempt_id: expectedAttempt.attack_attempt_id,
      obligation_id: expectedAttempt.obligation_id,
      node_sha256: expectedAttempt.node_sha256,
      graph_sha256: expectedAttempt.graph_sha256,
      artifact_sha256: expectedAttempt.artifact_sha256,
      mode: expectedAttempt.mode,
      ordinal: expectedAttempt.ordinal,
    },
  }
}
