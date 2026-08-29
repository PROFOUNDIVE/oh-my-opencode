import { describe, expect, test } from "bun:test"

import { CampaignJobAttemptSchema } from "./index"

const HASH = "a".repeat(64)

describe("campaign job attempts", () => {
  test("parses every durable job phase with strict idempotency and provenance", () => {
    // given
    const base = jobBase()
    const session = { child_session_id: "ses_jobChild1" }
    const completion = {
      ...session,
      raw_output_sha256: HASH,
      receipt: { kind: "CANDIDATE_ARTIFACT", candidate_id: "direct-01", artifact_sha256: HASH },
    }
    const attempts = [
      { ...base, phase: "PREPARED" },
      { ...base, phase: "SESSION_CREATED", ...session },
      { ...base, phase: "PROMPT_SENT", ...session },
      { ...base, phase: "COMPLETED", ...completion },
      { ...base, phase: "COMMITTED", ...completion },
    ]

    // when
    const results = attempts.map((attempt) => CampaignJobAttemptSchema.safeParse(attempt))

    // then
    expect(results.every((result) => result.success)).toBe(true)
    expect(results.map((result) => result.success && result.data.phase)).toEqual([
      "PREPARED",
      "SESSION_CREATED",
      "PROMPT_SENT",
      "COMPLETED",
      "COMMITTED",
    ])
  })

  test("rejects malformed job IDs, phase regressions, and target-receipt identity mismatches", () => {
    // given
    const base = jobBase()
    const invalid = [
      { ...base, job_id: "candidate-job", phase: "PREPARED" },
      { ...base, phase: "PROMPT_SENT" },
      { ...base, phase: "PREPARED", phase_revision: 2, prepared_at_revision: 3 },
      {
        ...base,
        phase: "COMMITTED",
        child_session_id: "ses_jobChild1",
        raw_output_sha256: HASH,
        receipt: { kind: "SCREEN", screen_id: "screen-direct-01" },
      },
    ]

    // when
    const results = invalid.map((attempt) => CampaignJobAttemptSchema.safeParse(attempt))

    // then
    expect(results.every((result) => !result.success)).toBe(true)
  })

  test("allows committed error receipts without inventing interpreted failure objects", () => {
    // given
    const input = {
      ...jobBase(),
      phase: "COMMITTED",
      child_session_id: "ses_jobChild1",
      raw_output_sha256: HASH,
      receipt: { kind: "ERROR", error_code: "SUBAGENT_FAILED", message: "transport failed" },
    }

    // when
    const parsed = CampaignJobAttemptSchema.parse(input)

    // then
    expect(parsed).toMatchObject({ receipt: input.receipt })
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.target)).toBe(true)
  })
})

function jobBase() {
  return {
    job_id: "job-discovery-direct-01",
    target: { kind: "CANDIDATE", candidate_id: "direct-01" },
    attempt_number: 1,
    prepared_at_revision: 2,
    phase_revision: 2,
    idempotency_key: HASH,
    role: "candidate-generator",
    resolved_model: { providerID: "openai", modelID: "gpt-5" },
    profile_sha256: HASH,
    prompt_sha256: HASH,
    reference_sha256: HASH,
    input_sha256: HASH,
    child_title: `[openmath-research:${HASH}] discovery direct-01`,
  }
}
