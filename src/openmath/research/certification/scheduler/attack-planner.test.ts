import { describe, expect, test } from "bun:test"

import { CoverageReviewSchema } from "../state/coverage"
import { CertificationGraphSchema } from "../state/graph"
import { mixedGraphFixture } from "../state/certification-test-fixture"
import {
  planBoundedCertificationAttacks,
  type CertificationAttackPlanEntry,
} from "./attack-planner"

const PROFILE = {
  allowed_attack_modes: ["EDGE_CASE", "FINITE_SEARCH", "ASSUMPTION_REMOVAL"],
  max_attacks_per_obligation: 2,
  max_active_certification_jobs: 2,
} as const

describe("bounded certification attack planning", () => {
  test("enumerates the complete required-root prerequisite closure in canonical node then mode order", () => {
    // given
    const graph = CertificationGraphSchema.parse(mixedGraphFixture())

    // when
    const result = planBoundedCertificationAttacks(plannerInput(graph))

    // then
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan).toHaveLength(12)
    expect(result.plan.map((attempt) => [String(attempt.obligation_id), attempt.mode, attempt.ordinal])).toEqual([
      ["obligation-0001", "EDGE_CASE", 1],
      ["obligation-0001", "FINITE_SEARCH", 2],
      ["obligation-0002", "EDGE_CASE", 3],
      ["obligation-0002", "FINITE_SEARCH", 4],
      ["obligation-0003", "EDGE_CASE", 5],
      ["obligation-0003", "FINITE_SEARCH", 6],
      ["obligation-0004", "EDGE_CASE", 7],
      ["obligation-0004", "FINITE_SEARCH", 8],
      ["obligation-0005", "EDGE_CASE", 9],
      ["obligation-0005", "FINITE_SEARCH", 10],
      ["obligation-0006", "EDGE_CASE", 11],
      ["obligation-0006", "FINITE_SEARCH", 12],
    ])
  })

  test("truncates modes by the total per-obligation cap and rejects duplicate or disallowed modes", () => {
    // given
    const graph = CertificationGraphSchema.parse(mixedGraphFixture())

    // when
    const capped = planBoundedCertificationAttacks(plannerInput(graph))
    const duplicate = planBoundedCertificationAttacks(plannerInput(graph, {
      ...PROFILE,
      allowed_attack_modes: ["EDGE_CASE", "EDGE_CASE"],
    }))
    const disallowed = planBoundedCertificationAttacks(plannerInput(graph, {
      ...PROFILE,
      allowed_attack_modes: ["EDGE_CASE", "UNTRUSTED_MODE"],
    }))

    // then
    expect(capped.ok && [...new Set(capped.plan.map((attempt) => attempt.mode))]).toEqual(["EDGE_CASE", "FINITE_SEARCH"])
    expect(duplicate).toMatchObject({ ok: false, error_code: "INVALID_PROFILE" })
    expect(disallowed).toMatchObject({ ok: false, error_code: "INVALID_PROFILE" })
  })

  test("limits the deterministic ready window by active jobs", () => {
    // given
    const graph = CertificationGraphSchema.parse(mixedGraphFixture())
    const initial = planBoundedCertificationAttacks(plannerInput(graph))
    if (!initial.ok) throw new TypeError("Expected initial attack plan")
    const first = initial.plan[0]
    if (first === undefined) throw new TypeError("Expected first attack target")

    // when
    const oneActive = planBoundedCertificationAttacks({
      ...plannerInput(graph),
      active_targets: [jobTarget(first)],
    })
    const full = planBoundedCertificationAttacks({
      ...plannerInput(graph),
      active_targets: initial.plan.slice(0, 2).map(jobTarget),
    })

    // then
    expect(oneActive.ok ? oneActive.ready.map((attempt) => String(attempt.attack_attempt_id)) : []).toEqual(["attack-0002"])
    expect(full.ok ? full.ready : []).toEqual([])
  })

  test("canonicalizes out-of-order terminal completion without changing remaining identities", () => {
    // given
    const graph = CertificationGraphSchema.parse(mixedGraphFixture())
    const initial = planBoundedCertificationAttacks(plannerInput(graph))
    if (!initial.ok) throw new TypeError("Expected initial attack plan")
    const first = initial.plan[0]
    const second = initial.plan[1]
    if (first === undefined || second === undefined) throw new TypeError("Expected attack targets")

    // when
    const left = planBoundedCertificationAttacks({ ...plannerInput(graph), terminal_attempts: [terminal(second, "INCONCLUSIVE"), terminal(first, "INVALID_TARGET")] })
    const right = planBoundedCertificationAttacks({ ...plannerInput(graph), terminal_attempts: [terminal(first, "INVALID_TARGET"), terminal(second, "INCONCLUSIVE")] })

    // then
    expect(left).toEqual(right)
    expect(left.ok ? left.terminal_attempts.map((attempt) => String(attempt.attack_attempt_id)) : []).toEqual(["attack-0001", "attack-0002"])
    expect(left.ok ? left.ready.map((attempt) => String(attempt.attack_attempt_id)) : []).toEqual(["attack-0003", "attack-0004"])
  })

  test("fails closed for stale, duplicate, or over-cap active target identities", () => {
    // given
    const graph = CertificationGraphSchema.parse(mixedGraphFixture())
    const initial = planBoundedCertificationAttacks(plannerInput(graph))
    if (!initial.ok) throw new TypeError("Expected initial attack plan")
    const first = initial.plan[0]
    if (first === undefined) throw new TypeError("Expected first attack target")
    const target = jobTarget(first)

    // when
    const stale = planBoundedCertificationAttacks({ ...plannerInput(graph), active_targets: [{ ...target, graph_sha256: "f".repeat(64) }] })
    const duplicate = planBoundedCertificationAttacks({ ...plannerInput(graph), active_targets: [target, target] })
    const overCap = planBoundedCertificationAttacks({ ...plannerInput(graph), active_targets: initial.plan.slice(0, 3).map(jobTarget) })

    // then
    expect(stale).toMatchObject({ ok: false, error_code: "STALE_TARGET" })
    expect(duplicate).toMatchObject({ ok: false, error_code: "DUPLICATE_ATTEMPT" })
    expect(overCap).toMatchObject({ ok: false, error_code: "CONCURRENCY_LIMIT_EXCEEDED" })
  })
})

function plannerInput(graph: ReturnType<typeof CertificationGraphSchema.parse>, profile: Readonly<Record<string, unknown>> = PROFILE) {
  return { graph, coverage: coverage(graph), profile, active_targets: [], terminal_attempts: [] }
}

function coverage(graph: ReturnType<typeof CertificationGraphSchema.parse>) {
  return CoverageReviewSchema.parse({
    coverage_review_id: "coverage-0001",
    certification_revision: 2,
    job_id: "cert-job-coverage-0001",
    coverage_round: 1,
    artifact_sha256: graph.artifact.artifact_sha256,
    graph_sha256: graph.graph_sha256,
    verdict: "PASS",
    findings: [],
  })
}

function jobTarget(attempt: CertificationAttackPlanEntry) {
  return {
    kind: "ATTACK" as const,
    attack_attempt_id: attempt.attack_attempt_id,
    obligation_id: attempt.obligation_id,
    node_sha256: attempt.node_sha256,
    graph_sha256: attempt.graph_sha256,
    artifact_sha256: attempt.artifact_sha256,
    mode: attempt.mode,
    ordinal: attempt.ordinal,
  }
}

function terminal(attempt: CertificationAttackPlanEntry, outcome: "INVALID_TARGET" | "INCONCLUSIVE") {
  return {
    ...attempt,
    certification_revision: 3,
    job_id: `cert-job-${String(attempt.attack_attempt_id)}`,
    outcome,
    witness: null,
    witness_sha256: null,
  }
}
