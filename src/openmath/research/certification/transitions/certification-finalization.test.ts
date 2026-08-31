import { describe, expect, test } from "bun:test"

import { sha256 } from "../../../workflow/stage-runner/sha256"
import { hashCertificationSummary } from "../state/summary"
import { ResearchCertificationStateV1Schema, type ResearchCertificationStateV1 } from "../state/schema"
import { reduceCertificationTransition } from "./index"
import { completeTransitionState, TRANSITION_PROFILE } from "./transition-test-fixture"

describe("certification finalization", () => {
  test("fails closed when a verifier job failed before a terminal witness was recorded", () => {
    // given
    const complete = completeTransitionState("REJECTED")
    const witnessJob = complete.job_attempts.find((job) => job.job_kind === "WITNESS" && job.phase === "COMMITTED")
    if (witnessJob?.phase !== "COMMITTED") throw new TypeError("Missing committed witness job")
    const ready = ResearchCertificationStateV1Schema.parse({
      ...complete,
      certification_revision: complete.certification_revision - 1,
      phase: "WITNESS_VERIFICATION",
      status: "READY",
      job_attempts: [...complete.job_attempts, {
        ...witnessJob,
        job_id: "cert-job-witness-failed",
        child_session_id: "ses_certWitnessFailed",
        raw_output_sha256: sha256("failed verifier output"),
        receipt: { kind: "ERROR", error_code: "ADAPTER_OUTPUT_INVALID", message: "Malformed verifier output" },
      }],
      summary: null,
      finalization: null,
    })

    // when
    const result = reduceCertificationTransition(ready, { type: "COMPLETE", profile: TRANSITION_PROFILE }, ready.certification_revision)

    // then
    expect(result).toMatchObject({ ok: false, error_code: "VALIDATION_ERROR", state: ready })
  })

  test("builds byte-identical count-only summaries regardless of terminal outcome order", () => {
    // given
    const left = readyState("REJECTED", "INVALID_TARGET", "INCONCLUSIVE")
    const right = readyState("REJECTED", "INCONCLUSIVE", "INVALID_TARGET")

    // when
    const results = [left, right].map(completeState)

    // then
    expect(results.every((result) => result.ok && result.state.status === "COMPLETE")).toBe(true)
    if (!results[0]?.ok || results[0].state.status !== "COMPLETE"
      || !results[1]?.ok || results[1].state.status !== "COMPLETE") throw new TypeError("Expected complete summaries")
    const leftBytes = JSON.stringify(results[0].state.summary)
    const rightBytes = JSON.stringify(results[1].state.summary)
    expect(leftBytes).toBe(rightBytes)
    expect(hashCertificationSummary(results[0].state.summary)).toBe(String(results[0].state.finalization.summary_sha256))
    expect(results[1].state.finalization.summary_sha256).toBe(results[0].state.finalization.summary_sha256)
    expect(Object.keys(results[0].state.summary)).toEqual([
      "schema_version", "certification_id", "generation_id", "certification_revision", "artifact_sha256",
      "graph_sha256", "coverage_verdict", "total_obligation_count", "required_obligation_count",
      "attack_outcomes", "witness_outcomes", "uncertainty_count", "approval_eligible",
    ])
    expect(results[0].state.summary).toMatchObject({
      attack_outcomes: { counterexample_found: 1, no_counterexample_found: 3, invalid_target: 1, inconclusive: 1 },
      witness_outcomes: { confirmed: 0, rejected: 1, inconclusive: 0 },
      uncertainty_count: 1,
      approval_eligible: true,
    })
  })

  test("retains every witness outcome and permits approval only for rejected witnesses", () => {
    // given
    const outcomes = ["REJECTED", "INCONCLUSIVE", "CONFIRMED"] as const

    // when
    const results = outcomes.map((outcome) => completeState(readyState(outcome)))

    // then
    expect(results.map((result) => result.ok && result.state.status === "COMPLETE"
      ? [result.state.summary.witness_outcomes, result.state.summary.approval_eligible]
      : null)).toEqual([
      [{ confirmed: 0, rejected: 1, inconclusive: 0 }, true],
      [{ confirmed: 0, rejected: 0, inconclusive: 1 }, false],
      [{ confirmed: 1, rejected: 0, inconclusive: 0 }, false],
    ])
  })

  test("refuses completion without every planned attack, required witness, or PASS coverage", () => {
    // given
    const attackBase = readyState()
    const removedAttack = attackBase.attack_attempts[attackBase.attack_attempts.length - 1]
    if (removedAttack === undefined) throw new TypeError("Missing attack fixture")
    const missingAttack = ResearchCertificationStateV1Schema.parse({
      ...attackBase,
      attack_attempts: attackBase.attack_attempts.slice(0, -1),
      evidence_receipts: attackBase.evidence_receipts.filter((receipt) => receipt.job_id !== removedAttack.job_id),
      job_attempts: attackBase.job_attempts.filter((job) => job.job_id !== removedAttack.job_id),
    })
    const witnessBase = readyState("REJECTED")
    const witnessJob = witnessBase.witness_verifications[0]?.job_id
    if (witnessJob === undefined) throw new TypeError("Missing witness fixture")
    const missingWitness = ResearchCertificationStateV1Schema.parse({
      ...witnessBase,
      witness_verifications: [],
      evidence_receipts: witnessBase.evidence_receipts.filter((receipt) => receipt.job_id !== witnessJob),
      job_attempts: witnessBase.job_attempts.filter((job) => job.job_id !== witnessJob),
    })
    const coverage = attackBase.coverage_reviews[attackBase.coverage_reviews.length - 1]
    if (coverage === undefined) throw new TypeError("Missing coverage fixture")
    const failedCoverage = ResearchCertificationStateV1Schema.parse({
      ...attackBase,
      coverage_reviews: [...attackBase.coverage_reviews.slice(0, -1), { ...coverage, verdict: "INCONCLUSIVE" }],
    })

    // when
    const results = [missingAttack, missingWitness, failedCoverage].map(completeState)

    // then
    expect(results.every((result) => !result.ok && result.error_code === "VALIDATION_ERROR")).toBe(true)
  })
})

type WitnessOutcome = "CONFIRMED" | "REJECTED" | "INCONCLUSIVE"
type NegativeOutcome = "NO_COUNTEREXAMPLE_FOUND" | "INVALID_TARGET" | "INCONCLUSIVE"

function readyState(
  witnessOutcome?: WitnessOutcome,
  secondOutcome: NegativeOutcome = "NO_COUNTEREXAMPLE_FOUND",
  thirdOutcome: NegativeOutcome = "NO_COUNTEREXAMPLE_FOUND",
): ResearchCertificationStateV1 {
  const complete = completeTransitionState(witnessOutcome)
  return ResearchCertificationStateV1Schema.parse({
    ...complete,
    certification_revision: complete.certification_revision - 1,
    phase: "WITNESS_VERIFICATION",
    status: "READY",
    attack_attempts: complete.attack_attempts.map((attack, index) => index === 1
      ? { ...attack, outcome: secondOutcome }
      : index === 2 ? { ...attack, outcome: thirdOutcome } : attack),
    summary: null,
    finalization: null,
  })
}

function completeState(state: ResearchCertificationStateV1) {
  return reduceCertificationTransition(state, { type: "COMPLETE", profile: TRANSITION_PROFILE }, state.certification_revision)
}
