import { afterEach, describe, expect, test } from "bun:test"

import { CertificationJobAttemptSchema, CertificationJobReceiptSchema } from "../state/jobs"
import { certificationOperationFixture } from "../transitions/operation-test-fixture"
import {
  certificationJobProgressInput,
  certificationJobRuntime,
  currentCertificationJobStatus,
  inertCertificationJobRuntime,
  promptSentCertificationJobSetup,
  removeCertificationJobTestDirectories,
  runningCertificationJobSetup,
} from "./certification-job-operation-test-fixture"
import { persistCertificationJobLifecycle } from "./persist-certification-job-lifecycle"
import { progressCertificationJobAttempt } from "./progress-certification-job-attempt"

afterEach(() => {
  removeCertificationJobTestDirectories()
})

describe("certification job operation failures", () => {
  test.each([
    "ADAPTER_OUTPUT_INVALID",
    "DISPATCH_FAILED",
    "STALE_OUTPUT",
  ] as const)("accepts the declared %s operational receipt code", (errorCode) => {
    // given
    const receipt = { kind: "ERROR", error_code: errorCode, message: "operation failed" }

    // when
    const result = CertificationJobReceiptSchema.safeParse(receipt)

    // then
    expect(result.success).toBe(true)
  })

  test.each([
    { description: "unknown", errorCode: "MODEL_CHOSEN_ARBITRARY_CODE" },
    { description: "blank", errorCode: "" },
  ])("rejects an $description operational receipt code", ({ errorCode }) => {
    // given
    const receipt = { kind: "ERROR", error_code: errorCode, message: "operation failed" }

    // when
    const result = CertificationJobReceiptSchema.safeParse(receipt)

    // then
    expect(result.success).toBe(false)
  })

  test("durably blocks duplicate children without choosing a winner", async () => {
    // given
    const setup = await runningCertificationJobSetup()
    let dispatches = 0
    const runtime = certificationJobRuntime(setup, {
      list_children: async () => [{ id: "ses_child1" }, { id: "ses_child2" }],
      get_session: async () => ({ title: setup.attempt.child_title }),
      dispatch: async () => {
        dispatches += 1
        return { ok: true, session_id: "ses_child1", text: "unused" }
      },
    })

    // when
    const result = await progressCertificationJobAttempt(certificationJobProgressInput(setup.attempt, runtime, setup.receipt))

    // then
    expect(result).toMatchObject({
      kind: "blocked",
      evidence: { kind: "DUPLICATE_CHILDREN", child_session_ids: ["ses_child1", "ses_child2"] },
    })
    expect(dispatches).toBe(0)
    expect(await currentCertificationJobStatus(setup)).toEqual({ status: "BLOCKED", blocked_reason: "RECONCILIATION_AMBIGUOUS" })
  })

  test("durably blocks duplicate prompt markers without sending another prompt", async () => {
    // given
    const setup = await runningCertificationJobSetup()
    const session = await persistCertificationJobLifecycle({
      directory: setup.directory,
      identity: setup.identity,
      update: { phase: "SESSION_CREATED", job_id: setup.attempt.job_id, child_session_id: "ses_child1" },
    })
    if (!session.ok || session.attempt.phase !== "SESSION_CREATED") throw new TypeError("Expected session receipt")
    const marker = `OPENMATH_CERTIFICATION_JOB_KEY: ${session.attempt.idempotency_key}\n`
    let dispatches = 0
    const runtime = certificationJobRuntime(setup, {
      list_messages: async () => [
        { role: "user", text: `${marker}payload` },
        { role: "user", text: `${marker}payload` },
      ],
      dispatch: async () => {
        dispatches += 1
        return { ok: true, session_id: "ses_child1", text: "unused" }
      },
    })

    // when
    const result = await progressCertificationJobAttempt(certificationJobProgressInput(session.attempt, runtime, setup.receipt))

    // then
    expect(result).toMatchObject({ kind: "blocked", evidence: { kind: "DUPLICATE_PROMPT_MARKERS", marker_count: 2 } })
    expect(dispatches).toBe(0)
    expect(await currentCertificationJobStatus(setup)).toEqual({ status: "BLOCKED", blocked_reason: "RECONCILIATION_AMBIGUOUS" })
  })

  test.each([
    {
      name: "stale output session",
      transport: { ok: true, session_id: "ses_stale1", text: "stale output" },
      errorCode: "STALE_OUTPUT",
    },
    {
      name: "malformed transport result",
      transport: { ok: true, text: "missing session" },
      errorCode: "ADAPTER_OUTPUT_INVALID",
    },
    {
      name: "dispatch failure",
      transport: { ok: false, error: "transport unavailable" },
      errorCode: "DISPATCH_FAILED",
    },
  ])("persists $name as an operation error, not a mathematical outcome", async ({ transport, errorCode }) => {
    // given
    const setup = await promptSentCertificationJobSetup()
    let dispatches = 0
    const runtime = certificationJobRuntime(setup, {
      dispatch: async () => {
        dispatches += 1
        return transport
      },
    })

    // when
    const result = await progressCertificationJobAttempt(certificationJobProgressInput(setup.attempt, runtime, setup.receipt))
    if (result.kind !== "failed") throw new TypeError("Expected a durably failed job")
    const restarted = await progressCertificationJobAttempt(certificationJobProgressInput(result.attempt, runtime, setup.receipt))

    // then
    expect(result).toMatchObject({ kind: "failed", attempt: { phase: "COMPLETED", receipt: { kind: "ERROR", error_code: errorCode } } })
    expect(restarted).toMatchObject({ kind: "failed", attempt: { phase: "COMPLETED" } })
    expect(dispatches).toBe(1)
  })

  test("persists a target-mismatched receipt as an adapter operation error", async () => {
    // given
    const setup = await promptSentCertificationJobSetup()
    const runtime = certificationJobRuntime(setup, {
      dispatch: async () => ({ ok: true, session_id: "ses_child1", text: "wrong target" }),
    })
    const input = certificationJobProgressInput(setup.attempt, runtime, setup.receipt)

    // when
    const result = await progressCertificationJobAttempt({
      ...input,
      receipt_from_output: () => CertificationJobReceiptSchema.parse({
        kind: "COVERAGE",
        coverage_review_id: "coverage-9999",
      }),
    })

    // then
    expect(result).toMatchObject({
      kind: "failed",
      attempt: { receipt: { kind: "ERROR", error_code: "ADAPTER_OUTPUT_INVALID" } },
    })
  })

  test("does not dispatch an already committed logical job", async () => {
    // given
    const committed = certificationOperationFixture().extraction.completed
    if (committed.phase !== "COMPLETED") throw new TypeError("Expected completed fixture")
    const parsed = CertificationJobAttemptSchema.parse({ ...committed, phase: "COMMITTED" })
    if (parsed.phase !== "COMMITTED") throw new TypeError("Expected committed fixture")
    let dispatches = 0
    const runtime = inertCertificationJobRuntime(async () => {
      dispatches += 1
      return { ok: true, session_id: "ses_child1", text: "unused" }
    })

    // when
    const result = await progressCertificationJobAttempt(certificationJobProgressInput(parsed, runtime, committed.receipt))

    // then
    expect(result).toMatchObject({ kind: "committed" })
    expect(dispatches).toBe(0)
  })
})
