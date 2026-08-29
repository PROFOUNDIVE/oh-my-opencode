import { describe, expect, test } from "bun:test"

import {
  CampaignHashSchema,
  CampaignJobAttemptSchema,
  CampaignJobTargetSchema,
} from "../state"
import { emptyDiscoveryState } from "../transitions/transition-test-fixture"
import { prepareCampaignJobAttempt } from "./prepare-campaign-job-attempt"
import {
  reconcilePreparedCampaignJob,
  reconcileSessionCreatedCampaignJob,
} from "./reconcile-campaign-job"

const HASH_A = CampaignHashSchema.parse("a".repeat(64))
const HASH_B = CampaignHashSchema.parse("b".repeat(64))

describe("campaign job reconciliation", () => {
  test("derives stable identity from the exact parent campaign revision and provenance", () => {
    // given
    const state = emptyDiscoveryState()
    const input = {
      state,
      job_id: "job-discovery-direct-01",
      target: CampaignJobTargetSchema.parse({ kind: "CANDIDATE", candidate_id: "direct-01" }),
      role: "candidate-generator",
      resolved_model: { providerID: "openai", modelID: "gpt-5", variant: "high" },
      profile_sha256: HASH_A,
      prompt_sha256: HASH_B,
      reference_sha256: HASH_A,
      input_sha256: HASH_B,
    }

    // when
    const first = prepareCampaignJobAttempt(input)
    const second = prepareCampaignJobAttempt(input)

    // then
    expect(first).toEqual(second)
    expect(first).toMatchObject({
      phase: "PREPARED",
      prepared_at_revision: 1,
      phase_revision: 1,
      role: "candidate-generator",
      resolved_model: input.resolved_model,
    })
    expect(first.child_title).toStartWith(`[openmath-research:${first.idempotency_key}]`)
  })

  test.each([
    [[], "create"],
    [["ses_only"] as const, "resume"],
    [["ses_first", "ses_second"] as const, "blocked"],
  ] as const)("reconciles %s matching child sessions as %s", async (matchingIds: readonly string[], expectedKind: string) => {
    // given
    const attempt = preparedAttempt()

    // when
    const result = await reconcilePreparedCampaignJob({
      parent_session_id: "ses_parent1",
      attempt,
      list_children: async () => matchingIds.map((id: string) => ({ id })),
      get_session: async () => ({ title: attempt.child_title }),
    })

    // then
    expect(result.kind).toBe(expectedKind)
  })

  test.each([
    [[], "send"],
    [["marker"] as const, "resume"],
    [["marker", "marker"] as const, "blocked"],
  ] as const)("reconciles %s matching prompt markers as %s", async (markers: readonly string[], expectedKind: string) => {
    // given
    const prepared = preparedAttempt()
    const attempt = CampaignJobAttemptSchema.parse({
      ...prepared,
      phase: "SESSION_CREATED",
      phase_revision: 2,
      child_session_id: "ses_child1",
    })
    if (attempt.phase !== "SESSION_CREATED") throw new TypeError("Expected a session-created campaign job")
    const marker = `OPENMATH_RESEARCH_JOB_KEY: ${attempt.idempotency_key}\n`

    // when
    const result = await reconcileSessionCreatedCampaignJob({
      attempt,
      list_messages: async () => markers.map(() => ({ role: "user", text: `${marker}payload` })),
    })

    // then
    expect(result.kind).toBe(expectedKind)
  })

  test("fails closed when child-session inspection is ambiguous", async () => {
    // given
    const attempt = preparedAttempt()

    // when
    const result = await reconcilePreparedCampaignJob({
      parent_session_id: "ses_parent1",
      attempt,
      list_children: async () => [{ id: "ses_child1" }],
      get_session: async () => { throw new Error("unavailable") },
    })

    // then
    expect(result).toEqual({
      kind: "blocked",
      message: "Unable to inspect a child session for the persisted campaign job: unavailable",
    })
  })
})

function preparedAttempt() {
  return prepareCampaignJobAttempt({
    state: emptyDiscoveryState(),
    job_id: "job-discovery-direct-01",
    target: CampaignJobTargetSchema.parse({ kind: "CANDIDATE", candidate_id: "direct-01" }),
    role: "candidate-generator",
    resolved_model: { providerID: "openai", modelID: "gpt-5" },
    profile_sha256: HASH_A,
    prompt_sha256: HASH_A,
    reference_sha256: HASH_A,
    input_sha256: HASH_A,
  })
}
