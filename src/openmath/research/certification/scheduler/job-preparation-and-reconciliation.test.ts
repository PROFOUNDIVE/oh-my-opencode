import { describe, expect, test } from "bun:test"

import { CertificationJobAttemptSchema, CertificationJobTargetSchema } from "../state/jobs"
import { ResearchCertificationStateV1Schema } from "../state/schema"
import { HASH_A, HASH_B, HASH_E, readyCertificationState } from "../state/certification-test-fixture"
import { prepareCertificationJobAttempt } from "./prepare-certification-job-attempt"
import {
  reconcilePreparedCertificationJob,
  reconcileSessionCreatedCertificationJob,
} from "./reconcile-certification-job"

const MODEL = { providerID: "openai", modelID: "gpt-5.6" }

describe("certification job preparation", () => {
  test("derives one deterministic extraction identity with exact provenance", () => {
    // given
    const state = ResearchCertificationStateV1Schema.parse(readyCertificationState())
    const input = {
      state,
      job_id: "cert-job-extraction-0001",
      target: CertificationJobTargetSchema.parse({
        kind: "EXTRACTION",
        coverage_round: 1,
        artifact_sha256: HASH_A,
      }),
      role: "certification-extractor",
      resolved_model: MODEL,
      prompt_sha256: HASH_B,
      input_sha256: HASH_E,
    }

    // when
    const first = prepareCertificationJobAttempt(input)
    const restarted = prepareCertificationJobAttempt(input)

    // then
    expect(restarted).toEqual(first)
    expect(first).toMatchObject({
      phase: "PREPARED",
      prepared_at_revision: 1,
      phase_revision: 1,
      attempt_number: 1,
      certification_id: state.certification_id,
      generation_id: state.generation_id,
      campaign_id: state.campaign_id,
      certification_profile_sha256: state.certification_profile_sha256,
      reference_sha256: state.reference_sha256,
      role: input.role,
      resolved_model: MODEL,
      prompt_sha256: input.prompt_sha256,
      input_sha256: input.input_sha256,
    })
    expect(first.child_title).toStartWith(`[openmath-certification:${first.idempotency_key}]`)
  })

  test("rejects a job whose target hash is not the selected artifact", () => {
    // given
    const state = ResearchCertificationStateV1Schema.parse(readyCertificationState())

    // when
    const prepare = () => prepareCertificationJobAttempt({
      state,
      job_id: "cert-job-extraction-0001",
      target: CertificationJobTargetSchema.parse({
        kind: "EXTRACTION",
        coverage_round: 1,
        artifact_sha256: HASH_B,
      }),
      role: "certification-extractor",
      resolved_model: MODEL,
      prompt_sha256: HASH_B,
      input_sha256: HASH_E,
    })

    // then
    expect(prepare).toThrow("STALE_ARTIFACT")
  })
})

describe("certification job reconciliation", () => {
  test.each([
    { children: [], expected: { kind: "create" } },
    { children: ["ses_child1"], expected: { kind: "resume", child_session_id: "ses_child1" } },
  ])("reconciles $children.length matching child sessions", async ({ children, expected }) => {
    // given
    const attempt = preparedAttempt()

    // when
    const result = await reconcilePreparedCertificationJob({
      parent_session_id: "ses_parent1",
      attempt,
      list_children: async () => children.map((id: string) => ({ id })),
      get_session: async (id: string) => ({ title: id === "other" ? "unrelated" : attempt.child_title }),
    })

    // then
    expect(result).toMatchObject(expected)
  })

  test("blocks and retains every duplicate child identity", async () => {
    // given
    const attempt = preparedAttempt()

    // when
    const result = await reconcilePreparedCertificationJob({
      parent_session_id: "ses_parent1",
      attempt,
      list_children: async () => [{ id: "ses_child1" }, { id: "ses_child2" }],
      get_session: async () => ({ title: attempt.child_title }),
    })

    // then
    expect(result).toEqual({
      kind: "blocked",
      reason: "RECONCILIATION_AMBIGUOUS",
      evidence: { kind: "DUPLICATE_CHILDREN", child_session_ids: ["ses_child1", "ses_child2"] },
    })
  })

  test("does not adopt a child with only an idempotency-prefix title match", async () => {
    // given
    const attempt = preparedAttempt()

    // when
    const result = await reconcilePreparedCertificationJob({
      parent_session_id: "ses_parent1",
      attempt,
      list_children: async () => [{ id: "ses_stale1" }],
      get_session: async () => ({ title: `${attempt.child_title} stale` }),
    })

    // then
    expect(result).toMatchObject({ kind: "create" })
  })

  test.each([
    { markerCount: 0, expected: { kind: "send" } },
    { markerCount: 1, expected: { kind: "resume" } },
  ])("reconciles $markerCount matching prompt markers", async ({ markerCount, expected }) => {
    // given
    const attempt = sessionCreatedAttempt()
    const marker = `OPENMATH_CERTIFICATION_JOB_KEY: ${attempt.idempotency_key}\n`

    // when
    const result = await reconcileSessionCreatedCertificationJob({
      attempt,
      list_messages: async () => Array.from({ length: markerCount }, () => ({ role: "user", text: `${marker}payload` })),
    })

    // then
    expect(result).toMatchObject(expected)
  })

  test("blocks and retains a duplicate prompt marker count", async () => {
    // given
    const attempt = sessionCreatedAttempt()
    const marker = `OPENMATH_CERTIFICATION_JOB_KEY: ${attempt.idempotency_key}\n`

    // when
    const result = await reconcileSessionCreatedCertificationJob({
      attempt,
      list_messages: async () => [
        { role: "user", text: `${marker}payload` },
        { role: "user", text: `${marker}payload` },
      ],
    })

    // then
    expect(result).toEqual({
      kind: "blocked",
      reason: "RECONCILIATION_AMBIGUOUS",
      evidence: { kind: "DUPLICATE_PROMPT_MARKERS", child_session_id: "ses_child1", marker_count: 2 },
    })
  })
})

function preparedAttempt() {
  return prepareCertificationJobAttempt({
    state: ResearchCertificationStateV1Schema.parse(readyCertificationState()),
    job_id: "cert-job-extraction-0001",
    target: CertificationJobTargetSchema.parse({ kind: "EXTRACTION", coverage_round: 1, artifact_sha256: HASH_A }),
    role: "certification-extractor",
    resolved_model: MODEL,
    prompt_sha256: HASH_B,
    input_sha256: HASH_E,
  })
}

function sessionCreatedAttempt() {
  const prepared = preparedAttempt()
  const parsed = CertificationJobAttemptSchema.parse({
    ...prepared,
    phase: "SESSION_CREATED" as const,
    phase_revision: 2,
    child_session_id: "ses_child1",
  })
  if (parsed.phase !== "SESSION_CREATED") throw new TypeError("Expected session-created certification job")
  return parsed
}
