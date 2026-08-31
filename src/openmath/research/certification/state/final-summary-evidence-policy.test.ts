import { describe, expect, test } from "bun:test"

import { completeTransitionState } from "../transitions/transition-test-fixture"
import { ResearchCertificationStateV1Schema } from "./schema"

describe("final certification evidence policy", () => {
  test("rejects stale evidence, stale verifier targets, and malformed verifier outcomes", () => {
    // given
    const complete = completeTransitionState("REJECTED")
    const staleEvidence = {
      ...complete,
      evidence_receipts: complete.evidence_receipts.map((receipt) => receipt.job_kind === "WITNESS"
        ? { ...receipt, graph_sha256: "f".repeat(64) }
        : receipt),
    }
    const staleTarget = {
      ...complete,
      job_attempts: complete.job_attempts.map((job) => job.job_kind === "WITNESS"
        ? { ...job, target: { ...job.target, graph_sha256: "f".repeat(64) } }
        : job),
    }
    const malformedWitness = {
      ...complete,
      witness_verifications: complete.witness_verifications.map((witness) => ({ ...witness, outcome: "FAILED" })),
    }
    const failedWitness = {
      ...complete,
      job_attempts: complete.job_attempts.map((job) => job.job_kind === "WITNESS"
        ? { ...job, receipt: { kind: "ERROR", error_code: "DISPATCH_FAILED", message: "Verifier failed" } }
        : job),
    }

    // when
    const results = [staleEvidence, staleTarget, malformedWitness, failedWitness]
      .map((state) => ResearchCertificationStateV1Schema.safeParse(state))

    // then
    expect(results.every((result) => !result.success)).toBe(true)
  })

  test("rejects reserved CAS, SMT, and Lean evidence at the persisted state boundary", () => {
    // given
    const complete = completeTransitionState("REJECTED")
    const reservedTypes = ["CAS", "SMT", "LEAN_KERNEL"] as const

    // when
    const results = reservedTypes.map((evidenceType) => ResearchCertificationStateV1Schema.safeParse({
      ...complete,
      evidence_receipts: complete.evidence_receipts.map((receipt, index) => index === 0
        ? { ...receipt, evidence_type: evidenceType }
        : receipt),
    }))

    // then
    expect(results.every((result) => !result.success)).toBe(true)
  })
})
