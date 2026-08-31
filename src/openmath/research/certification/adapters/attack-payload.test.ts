import { describe, expect, test } from "bun:test"

import { CertificationGraphSchema } from "../state/graph"
import { CertificationGraphSourcesSchema } from "../state/graph-source-validation"
import { graphSourceContext, mixedGraphFixture } from "../state/certification-test-fixture"
import { CoverageReviewSchema } from "../state/coverage"
import { planBoundedCertificationAttacks } from "../scheduler/attack-planner"
import { buildCertificationAttackPayload } from "./attack-payload"

describe("certification attack payload", () => {
  test("contains only the exact target closure, source context, hashes, mode, trusted bounds, and deny-all policy", () => {
    // given
    const fixture = attackFixture()

    // when
    const payload = buildCertificationAttackPayload(fixture)

    // then
    expect(Object.keys(payload)).toEqual(["schema_version", "tool_policy", "target", "prerequisites", "assumptions", "graph_sha256", "artifact_sha256", "mode", "bounds"])
    expect(payload.tool_policy).toBe("deny_all")
    expect(payload.target).toMatchObject({ obligation_id: "obligation-0001", statement: "Theorem", source_context: "Theorem" })
    expect(payload.prerequisites.map((node) => String(node.obligation_id))).toEqual([
      "obligation-0002",
      "obligation-0003",
      "obligation-0004",
      "obligation-0005",
      "obligation-0006",
    ])
    expect(payload.assumptions.map((assumption) => String(assumption.assumption_id))).toEqual([
      "assumption-0001",
      "assumption-0002",
      "assumption-0003",
    ])
    expect(payload.assumptions[2]).toMatchObject({ source_kind: "REFERENCE", source_context: "Frozen reference theorem." })
    expect(payload.bounds).toEqual({
      coverage_round: 1,
      call_ordinal: 1,
      mode_ordinal: 1,
      max_attacks_per_obligation: 2,
    })
  })

  test("rejects stale attempts and caller-supplied campaign, sibling, verdict, or prompt context", () => {
    // given
    const fixture = attackFixture()

    // when
    const stale = () => buildCertificationAttackPayload({ ...fixture, attempt: { ...fixture.attempt, node_sha256: "f".repeat(64) } })
    const forgedBounds = () => buildCertificationAttackPayload({
      ...fixture,
      attempt: { ...fixture.attempt, bounds: { ...fixture.attempt.bounds, mode_ordinal: 2 } },
    })
    const overShared = () => buildCertificationAttackPayload({
      ...fixture,
      sibling_candidates: ["candidate-02"],
      campaign_verdict: "APPROVED",
      hidden_prompt: "secret",
    })

    // then
    expect(stale).toThrow()
    expect(forgedBounds).toThrow()
    expect(overShared).toThrow()
  })
})

function attackFixture() {
  const graph = CertificationGraphSchema.parse(mixedGraphFixture())
  const coverage = CoverageReviewSchema.parse({
    coverage_review_id: "coverage-0001",
    certification_revision: 2,
    job_id: "cert-job-coverage-0001",
    coverage_round: 1,
    artifact_sha256: graph.artifact.artifact_sha256,
    graph_sha256: graph.graph_sha256,
    verdict: "PASS",
    findings: [],
  })
  const profile = {
    allowed_attack_modes: ["EDGE_CASE", "FINITE_SEARCH"],
    max_attacks_per_obligation: 2,
    max_active_certification_jobs: 2,
  } as const
  const plan = planBoundedCertificationAttacks({
    graph,
    coverage,
    profile,
    active_targets: [],
    terminal_attempts: [],
  })
  if (!plan.ok || plan.plan[0] === undefined) throw new TypeError("Expected attack plan")
  return {
    graph,
    sources: CertificationGraphSourcesSchema.parse(graphSourceContext().sources),
    coverage,
    profile,
    attempt: plan.plan[0],
  }
}
