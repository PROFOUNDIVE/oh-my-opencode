import { describe, expect, test } from "bun:test"

import { deriveCertificationIdentity, CertificationGenerationIndexV1Schema } from "./identity"
import { CertificationGenerationIndexReadSchema } from "./generation-index-read"
import { ResearchCertificationStateV1Schema } from "./schema"
import {
  CERTIFICATION_ID,
  GENERATION_ID,
  HASH_A,
  HASH_B,
  readyCertificationState,
  selectedArtifact,
} from "./certification-test-fixture"

const NONTERMINAL_PHASES = [
  "EXTRACTION",
  "COVERAGE_REVIEW",
  "COUNTEREXAMPLE_ATTACK",
  "WITNESS_VERIFICATION",
] as const

describe("certification generation identity", () => {
  test("derives the exact full generation digest and 32-hex certification prefix", () => {
    // given
    const input = { campaign_id: "campaign-a", selected_artifact_sha256: HASH_A, certification_profile_sha256: HASH_B }

    // when
    const identity = deriveCertificationIdentity(input)

    // then
    expect(String(identity.certification_id)).toBe(CERTIFICATION_ID)
    expect(String(identity.generation_id)).toBe(GENERATION_ID)
  })

  test("rejects a generation index whose identity does not bind its campaign, artifact, and profile", () => {
    // given
    const index = {
      schema_version: 1,
      campaign_id: "campaign-a",
      certification_id: CERTIFICATION_ID,
      generation_id: GENERATION_ID,
      selected_artifact: selectedArtifact(),
      certification_profile_sha256: HASH_B,
      initialized_from_campaign_revision: 11,
    }

    // when
    const valid = CertificationGenerationIndexV1Schema.safeParse(index)
    const invalid = CertificationGenerationIndexV1Schema.safeParse({ ...index, generation_id: "f".repeat(64) })

    // then
    expect(valid.success).toBe(true)
    expect(invalid.success).toBe(false)
  })

  test("revalidates canonical index bytes against external campaign, artifact, profile, and revision identity", () => {
    // given
    const index = {
      schema_version: 1,
      campaign_id: "campaign-a",
      certification_id: CERTIFICATION_ID,
      generation_id: GENERATION_ID,
      selected_artifact: selectedArtifact(),
      certification_profile_sha256: HASH_B,
      initialized_from_campaign_revision: 11,
    }
    const input = {
      serialized_bytes: JSON.stringify(index),
      expected_campaign_id: "campaign-a",
      expected_selected_artifact: selectedArtifact(),
      expected_certification_profile_sha256: HASH_B,
      expected_initialized_from_campaign_revision: 11,
    }

    // when
    const valid = CertificationGenerationIndexReadSchema.safeParse(input)
    const reordered = CertificationGenerationIndexReadSchema.safeParse({
      ...input,
      serialized_bytes: JSON.stringify({
        campaign_id: index.campaign_id,
        schema_version: index.schema_version,
        certification_id: index.certification_id,
        generation_id: index.generation_id,
        selected_artifact: index.selected_artifact,
        certification_profile_sha256: index.certification_profile_sha256,
        initialized_from_campaign_revision: index.initialized_from_campaign_revision,
      }),
    })
    const mismatched = CertificationGenerationIndexReadSchema.safeParse({ ...input, expected_campaign_id: "other-campaign" })

    // then
    expect(valid.success).toBe(true)
    expect(reordered.success).toBe(false)
    expect(mismatched.success).toBe(false)
  })
})

describe("certification phase and status contracts", () => {
  test("emits canonical state keys in the locked serialization order", () => {
    // given
    const input = readyCertificationState()

    // when
    const parsed = ResearchCertificationStateV1Schema.parse(input)

    // then
    expect(Object.keys(parsed)).toEqual([
      "schema_version", "certification_id", "generation_id", "campaign_id", "selected_artifact",
      "objective_sha256", "profile_sha256", "reference_sha256", "certification_profile_sha256",
      "certification_revision", "phase", "status", "awaiting_reason", "abort_requested", "abort_reason",
      "blocked_reason", "active_job_ids", "graphs", "coverage_reviews", "attack_attempts",
      "witness_verifications", "evidence_receipts", "amendments", "job_attempts", "summary", "finalization",
    ])
  })

  test("accepts every legal nonterminal phase and routine status combination", () => {
    // given
    const states = NONTERMINAL_PHASES.flatMap((phase) => [
      { ...readyCertificationState(), certification_revision: 1, phase },
      {
        ...readyCertificationState(),
        certification_revision: 1,
        phase,
        status: "RUNNING",
        active_job_ids: ["cert-job-extraction-0001"],
        job_attempts: [preparedExtractionJob()],
      },
      { ...readyCertificationState(), certification_revision: 1, phase, status: "BLOCKED", blocked_reason: "STALE_GRAPH" },
      { ...readyCertificationState(), certification_revision: 1, phase, status: "ABORTED", abort_requested: true, abort_reason: "stopped" },
    ])
    const awaiting = ["EXTRACTION", "COVERAGE_REVIEW"].map((phase) => ({
      ...readyCertificationState(),
      certification_revision: 1,
      phase,
      status: "AWAITING_HUMAN",
      awaiting_reason: "COVERAGE_REVIEW_REQUIRED",
    }))

    // when
    const results = [...states, ...awaiting].map((state) => ResearchCertificationStateV1Schema.safeParse(state))

    // then
    expect(results.every((result) => result.success)).toBe(true)
  })

  test("rejects illegal reasons, nullability, phases, active jobs, and cross-state fields", () => {
    // given
    const base = readyCertificationState()
    const invalid = [
      { ...base, phase: "COUNTEREXAMPLE_ATTACK", status: "AWAITING_HUMAN", awaiting_reason: "COVERAGE_REVIEW_REQUIRED" },
      { ...base, status: "BLOCKED", blocked_reason: "unknown" },
      { ...base, status: "RUNNING", active_job_ids: [] },
      { ...base, abort_reason: "without request" },
      { ...base, phase: "COMPLETE" },
      { ...base, phase: "COVERAGE_REVIEW" },
      { ...base, state_revision: 0 },
      { ...base, selected_candidate_id: "candidate-01" },
    ]

    // when
    const results = invalid.map((state) => ResearchCertificationStateV1Schema.safeParse(state))

    // then
    expect(results.every((result) => !result.success)).toBe(true)
  })
})

function preparedExtractionJob() {
  return {
    job_id: "cert-job-extraction-0001",
    job_kind: "EXTRACTION",
    certification_id: CERTIFICATION_ID,
    generation_id: GENERATION_ID,
    campaign_id: "campaign-a",
    target: { kind: "EXTRACTION", coverage_round: 1, artifact_sha256: HASH_A },
    attempt_number: 1,
    prepared_at_revision: 1,
    phase_revision: 1,
    idempotency_key: "6".repeat(64),
    role: "extractor",
    resolved_model: { providerID: "openai", modelID: "gpt-5" },
    certification_profile_sha256: HASH_B,
    prompt_sha256: "7".repeat(64),
    reference_sha256: "5".repeat(64),
    input_sha256: "8".repeat(64),
    child_title: "certification extraction",
    phase: "PREPARED",
  }
}
