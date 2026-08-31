import { describe, expect, test } from "bun:test"

import { AttackAttemptSchema } from "./attacks"
import { CoverageReviewSchema } from "./coverage"
import { EvidenceReceiptV1Schema } from "./evidence"
import { CertificationJobAttemptSchema } from "./jobs"
import { WitnessVerificationSchema } from "./witnesses"
import {
  CERTIFICATION_ID,
  GENERATION_ID,
  HASH_A,
  HASH_B,
  HASH_C,
  HASH_E,
} from "./certification-test-fixture"

describe("certification result contracts", () => {
  test("accepts only the exact categorical coverage, attack, and witness outcomes", () => {
    // given
    const coverage = coverageReview()
    const attack = attackAttempt()
    const witness = witnessVerification()

    // when
    const accepted = [
      CoverageReviewSchema.safeParse(coverage),
      AttackAttemptSchema.safeParse(attack),
      WitnessVerificationSchema.safeParse(witness),
    ]
    const rejected = [
      CoverageReviewSchema.safeParse({ ...coverage, verdict: "PROVED" }),
      AttackAttemptSchema.safeParse({ ...attack, outcome: "EXHAUSTIVE", evidence_type: "FINITE_EXHAUSTIVE_SEARCH" }),
      WitnessVerificationSchema.safeParse({ ...witness, outcome: "LIKELY_REJECTED" }),
    ]

    // then
    expect(accepted.every((result) => result.success)).toBe(true)
    expect(rejected.every((result) => !result.success)).toBe(true)
  })

  test("keeps persisted evidence narrow and derives its allowed type from job kind", () => {
    // given
    const review = evidenceReceipt("COVERAGE", "LLM_REVIEW")
    const counterargument = evidenceReceipt("ATTACK", "LLM_COUNTERARGUMENT")
    const reserved = ["EXECUTABLE_TEST", "FINITE_EXHAUSTIVE_SEARCH", "CAS", "SMT", "LEAN_KERNEL", "HUMAN_DOMAIN_EXPERT"]

    // when
    const accepted = [review, counterargument].map((receipt) => EvidenceReceiptV1Schema.safeParse(receipt))
    const wrongMapping = EvidenceReceiptV1Schema.safeParse({ ...counterargument, evidence_type: "LLM_REVIEW" })
    const reservedResults = reserved.map((evidenceType) => EvidenceReceiptV1Schema.safeParse({ ...review, evidence_type: evidenceType }))

    // then
    expect(accepted.every((result) => result.success)).toBe(true)
    expect(wrongMapping.success).toBe(false)
    expect(reservedResults.every((result) => !result.success)).toBe(true)
  })

  test("rejects a committed certification job receipt for another target", () => {
    // given
    const job = {
      ...jobBase(),
      phase: "COMMITTED",
      child_session_id: "ses_certJob1",
      raw_output_sha256: HASH_C,
      receipt: { kind: "ATTACK", attack_attempt_id: "attack-0002" },
    }

    // when
    const parsed = CertificationJobAttemptSchema.safeParse(job)

    // then
    expect(parsed.success).toBe(false)
  })
})

function coverageReview() {
  return {
    coverage_review_id: "coverage-0001",
    certification_revision: 2,
    job_id: "cert-job-coverage-0001",
    coverage_round: 1,
    artifact_sha256: HASH_A,
    graph_sha256: HASH_B,
    verdict: "PASS",
    findings: [],
  }
}

function attackAttempt() {
  return {
    attack_attempt_id: "attack-0001",
    certification_revision: 3,
    job_id: "cert-job-attack-0001",
    obligation_id: "obligation-0001",
    node_sha256: HASH_C,
    graph_sha256: HASH_B,
    artifact_sha256: HASH_A,
    mode: "FINITE_SEARCH",
    ordinal: 1,
    bounds: { coverage_round: 1, mode_ordinal: 1, max_attacks_per_obligation: 2, max_active_certification_jobs: 4 },
    outcome: "NO_COUNTEREXAMPLE_FOUND",
    witness: null,
    witness_sha256: null,
  }
}

function witnessVerification() {
  return {
    witness_verification_id: "witness-0001",
    certification_revision: 4,
    job_id: "cert-job-witness-0001",
    attack_attempt_id: "attack-0001",
    obligation_id: "obligation-0001",
    node_sha256: HASH_C,
    graph_sha256: HASH_B,
    artifact_sha256: HASH_A,
    witness_sha256: HASH_E,
    outcome: "REJECTED",
  }
}

function evidenceReceipt(jobKind: "COVERAGE" | "ATTACK", evidenceType: string) {
  return {
    schema_version: 1,
    evidence_id: jobKind === "ATTACK" ? "evidence-0002" : "evidence-0001",
    evidence_type: evidenceType,
    certification_id: CERTIFICATION_ID,
    generation_id: GENERATION_ID,
    campaign_id: "campaign-a",
    certification_revision: 3,
    job_id: jobKind === "ATTACK" ? "cert-job-attack-0001" : "cert-job-coverage-0001",
    job_kind: jobKind,
    artifact_sha256: HASH_A,
    graph_sha256: HASH_B,
    result_id: jobKind === "ATTACK" ? "attack-0001" : "coverage-0001",
    prompt_sha256: HASH_C,
    input_sha256: "4".repeat(64),
    output_sha256: HASH_E,
    child_session_id: "ses_certEvidence1",
    resolved_model: { providerID: "openai", modelID: "gpt-5" },
  }
}

function jobBase() {
  return {
    job_id: "cert-job-attack-0001",
    job_kind: "ATTACK",
    certification_id: CERTIFICATION_ID,
    generation_id: GENERATION_ID,
    campaign_id: "campaign-a",
    target: {
      kind: "ATTACK",
      attack_attempt_id: "attack-0001",
      obligation_id: "obligation-0001",
      node_sha256: HASH_C,
      graph_sha256: HASH_B,
      artifact_sha256: HASH_A,
      mode: "FINITE_SEARCH",
      ordinal: 1,
    },
    attempt_number: 1,
    prepared_at_revision: 3,
    phase_revision: 3,
    idempotency_key: "6".repeat(64),
    role: "counterexample",
    resolved_model: { providerID: "openai", modelID: "gpt-5" },
    certification_profile_sha256: "2".repeat(64),
    prompt_sha256: "7".repeat(64),
    reference_sha256: HASH_E,
    input_sha256: "8".repeat(64),
    child_title: "certification attack",
  }
}
