import { describe, expect, test } from "bun:test"

import { sha256 } from "../../../workflow/stage-runner/sha256"
import { CertificationGraphSourcesSchema } from "../state/graph-source-validation"
import { ResearchCertificationStateV1Schema } from "../state/schema"
import { graphSourceContext } from "../state/certification-test-fixture"
import { completeTransitionState } from "../transitions/transition-test-fixture"
import { planWitnessVerification } from "./plan-witness-verification"

describe("witness verification planning", () => {
  test("schedules exactly one frozen-role verifier job for the next terminal found attack", () => {
    // given
    const state = readyWitnessState()
    const context = witnessContext()

    // when
    const result = planWitnessVerification(state, context)

    // then
    expect(result).toMatchObject({
      ok: true,
      consume_amendment_ids: [],
      job_attempts: [{
        job_id: "cert-job-witness-0001",
        role: "witness-reviewer",
        resolved_model: { providerID: "openai", modelID: "gpt-5-witness" },
        target: { kind: "WITNESS", attack_attempt_id: "attack-0001", witness_verification_id: "witness-0001" },
      }],
    })
    if (!result.ok) throw new TypeError(result.message)
    expect(String(result.job_attempts[0]?.input_sha256)).toBe(sha256(JSON.stringify(result.payload)))
  })

  test("does not schedule negative invalid-target or inconclusive attacks", () => {
    // given
    const state = readyWitnessState()
    const withoutFound = ResearchCertificationStateV1Schema.parse({
      ...state,
      attack_attempts: state.attack_attempts.map((attack) => attack.outcome === "COUNTEREXAMPLE_FOUND" ? {
        ...attack,
        outcome: "NO_COUNTEREXAMPLE_FOUND",
        witness: null,
        witness_sha256: null,
      } : attack),
    })

    // when
    const result = planWitnessVerification(withoutFound, witnessContext())

    // then
    expect(result).toMatchObject({ ok: false, error_code: "ILLEGAL_TRANSITION" })
  })

  test("rejects duplicate verifier attempts and stale frozen identity", () => {
    // given
    const state = readyWitnessState()
    const planned = planWitnessVerification(state, witnessContext())
    if (!planned.ok || planned.job_attempts[0] === undefined) throw new TypeError("Missing planned witness")
    const duplicate = { ...state, job_attempts: [...state.job_attempts, planned.job_attempts[0]] }

    // when
    const duplicateResult = planWitnessVerification(duplicate, witnessContext())
    const staleResult = planWitnessVerification(state, { ...witnessContext(), reference_sha256: "f".repeat(64) })

    // then
    expect(duplicateResult).toMatchObject({ ok: false, error_code: "VALIDATION_ERROR" })
    expect(staleResult).toMatchObject({ ok: false, error_code: "PROFILE_HASH_MISMATCH" })
  })
})

export function readyWitnessState() {
  const complete = completeTransitionState("REJECTED")
  return ResearchCertificationStateV1Schema.parse({
    ...complete,
    certification_revision: 4,
    phase: "WITNESS_VERIFICATION",
    status: "READY",
    witness_verifications: [],
    evidence_receipts: complete.evidence_receipts.filter((receipt) => receipt.job_kind !== "WITNESS"),
    job_attempts: complete.job_attempts.filter((job) => job.job_kind !== "WITNESS"),
    summary: null,
    finalization: null,
  })
}

export function witnessContext() {
  const content = "witness verifier prompt"
  return {
    parent_session_id: "ses_parent_witness",
    sources: CertificationGraphSourcesSchema.parse(graphSourceContext().sources),
    profile_sha256: "4".repeat(64),
    reference_sha256: "5".repeat(64),
    certification_profile_sha256: "2".repeat(64),
    witness_role: {
      agent: "witness-reviewer",
      model: { providerID: "openai", modelID: "gpt-5-witness" },
      prompt: { content, content_hash: sha256(content) },
    },
  }
}
