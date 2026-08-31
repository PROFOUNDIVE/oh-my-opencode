import { describe, expect, test } from "bun:test"

import { sha256 } from "../../../workflow/stage-runner/sha256"
import { AttackAttemptSchema } from "../state/attacks"
import { CoverageReviewSchema } from "../state/coverage"
import { completeTransitionState, TRANSITION_PROFILE } from "./transition-test-fixture"
import {
  buildCertificationAttackPlan,
  buildWitnessSchedule,
  decideCoverageTransition,
  evaluateCertificationEligibility,
} from "./index"

describe("certification coverage decisions", () => {
  test("advances PASS, retries REVISE, and pauses inconclusive or exhausted coverage", () => {
    // given
    const state = completeTransitionState()
    const graph = state.graphs[0]
    const coverage = state.coverage_reviews[0]
    if (graph === undefined || coverage === undefined) throw new TypeError("Missing coverage fixture")
    const review = (verdict: "PASS" | "REVISE" | "INCONCLUSIVE", round: number) => CoverageReviewSchema.parse({
      ...coverage,
      coverage_review_id: `coverage-${String(round).padStart(4, "0")}`,
      coverage_round: round,
      verdict,
    })

    // when
    const decisions = [
      decideCoverageTransition({ coverage: review("PASS", 1), current_graph: graph, max_coverage_rounds: 2 }),
      decideCoverageTransition({ coverage: review("REVISE", 1), current_graph: graph, max_coverage_rounds: 2 }),
      decideCoverageTransition({ coverage: review("REVISE", 2), current_graph: graph, max_coverage_rounds: 2 }),
      decideCoverageTransition({ coverage: review("INCONCLUSIVE", 1), current_graph: graph, max_coverage_rounds: 2 }),
    ]

    // then
    expect(decisions).toEqual([
      { ok: true, phase: "COUNTEREXAMPLE_ATTACK", status: "READY", awaiting_reason: null },
      { ok: true, phase: "EXTRACTION", status: "READY", awaiting_reason: null },
      { ok: true, phase: "COVERAGE_REVIEW", status: "AWAITING_HUMAN", awaiting_reason: "COVERAGE_REVIEW_REQUIRED" },
      { ok: true, phase: "COVERAGE_REVIEW", status: "AWAITING_HUMAN", awaiting_reason: "COVERAGE_REVIEW_REQUIRED" },
    ])
  })

  test("rejects stale artifact and graph coverage", () => {
    // given
    const state = completeTransitionState()
    const graph = state.graphs[0]
    const coverage = state.coverage_reviews[0]
    if (graph === undefined || coverage === undefined) throw new TypeError("Missing coverage fixture")

    // when
    const staleGraph = decideCoverageTransition({
      coverage: CoverageReviewSchema.parse({ ...coverage, graph_sha256: "f".repeat(64) }),
      current_graph: graph,
      max_coverage_rounds: 2,
    })
    const staleArtifact = decideCoverageTransition({
      coverage: CoverageReviewSchema.parse({ ...coverage, artifact_sha256: "f".repeat(64) }),
      current_graph: graph,
      max_coverage_rounds: 2,
    })

    // then
    expect(staleGraph).toMatchObject({ ok: false, error_code: "STALE_GRAPH" })
    expect(staleArtifact).toMatchObject({ ok: false, error_code: "STALE_ARTIFACT" })
  })
})

describe("certification attack and witness scheduling", () => {
  test("orders required obligations before configured modes deterministically", () => {
    // given
    const state = completeTransitionState()
    const graph = state.graphs[0]
    const coverage = state.coverage_reviews[0]
    if (graph === undefined || coverage === undefined) throw new TypeError("Missing scheduling fixture")
    const profile = {
      ...TRANSITION_PROFILE,
      allowed_attack_modes: ["EDGE_CASE", "FINITE_SEARCH"],
      max_attacks_per_obligation: 2,
    } as const

    // when
    const plan = buildCertificationAttackPlan({ graph, coverage, profile })

    // then
    expect(plan).toHaveLength(graph.nodes.filter((node) => node.required).length * 2)
    expect(plan.slice(0, 3).map((entry) => [String(entry.obligation_id), entry.mode, entry.ordinal])).toEqual([
      ["obligation-0001", "EDGE_CASE", 1],
      ["obligation-0001", "FINITE_SEARCH", 2],
      ["obligation-0002", "EDGE_CASE", 3],
    ])
  })

  test("schedules one witness per found attack and preserves attack order", () => {
    // given
    const state = completeTransitionState("REJECTED")
    const attacks = state.attack_attempts.map((attack, index) => index < 2
      ? AttackAttemptSchema.parse({
          ...attack,
          outcome: "COUNTEREXAMPLE_FOUND",
          witness: `witness-${index}`,
          witness_sha256: sha256(`witness-${index}`),
        })
      : attack)

    // when
    const plan = buildWitnessSchedule(attacks, state.witness_verifications)

    // then
    expect(plan).toHaveLength(1)
    expect(plan[0]).toMatchObject({ attack_attempt_id: "attack-0002", witness_verification_id: "witness-0002" })
  })
})

describe("certification eligibility", () => {
  test("requires exact complete current attacks and only rejected witness outcomes for approval", () => {
    // given
    const states = [
      completeTransitionState(),
      completeTransitionState("REJECTED"),
      completeTransitionState("INCONCLUSIVE"),
      completeTransitionState("CONFIRMED"),
    ]

    // when
    const results = states.map((state) => evaluateCertificationEligibility({ state, profile: TRANSITION_PROFILE }))

    // then
    expect(results.map((result) => [result.completion_eligible, result.approval_eligible])).toEqual([
      [true, true],
      [true, true],
      [true, false],
      [true, false],
    ])
  })

  test("invalidates stale graph-bound work and incomplete witnesses", () => {
    // given
    const eligible = completeTransitionState("REJECTED")
    const graph = eligible.graphs[0]
    if (graph === undefined) throw new TypeError("Missing eligibility graph")
    const missingWitness = { ...eligible, witness_verifications: [] }

    // when
    const stale = evaluateCertificationEligibility({ state: eligible, profile: TRANSITION_PROFILE, observed_graph_sha256: "f".repeat(64) })
    const missing = evaluateCertificationEligibility({ state: missingWitness, profile: TRANSITION_PROFILE })

    // then
    expect(stale).toMatchObject({ completion_eligible: false, reason: "STALE_GRAPH" })
    expect(missing).toMatchObject({ completion_eligible: false, reason: "INCOMPLETE_WITNESSES" })
  })
})
