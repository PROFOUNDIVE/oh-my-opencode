import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { reduceCertificationTransition } from "../transitions/reduce-transition"
import { certificationOperationFixture } from "../transitions/operation-test-fixture"
import { compareAndSwapCertificationGeneration, initializeCertificationGeneration } from "../storage"
import {
  createCertificationJobCrashHarness,
  type CertificationJobCrashBoundary,
} from "./certification-job-crash-test-runtime"
import { prepareCertificationJobAttempt } from "./prepare-certification-job-attempt"
import { progressCertificationJobAttempt } from "./progress-certification-job-attempt"

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("certification job restart reconciliation", () => {
  test.each([
    "BEFORE_SESSION_CREATED",
    "CHILD_CREATED",
    "SESSION_CREATED",
    "BEFORE_PROMPT_SENT",
    "PROMPT_APPENDED",
    "PROMPT_SENT",
    "OUTPUT_FETCHED",
    "BEFORE_COMPLETED",
    "COMPLETED",
  ] as const)("converges after %s without a duplicate child or prompt", async (boundary: CertificationJobCrashBoundary) => {
    // given
    const fixture = certificationOperationFixture()
    const attempt = preparedAttempt(fixture)
    const directory = temporaryDirectory()
    const identity = storageIdentity(fixture.initial)
    await initializeCertificationGeneration({ directory, state: fixture.initial, initialized_from_campaign_revision: 12 })
    const prepared = reduceCertificationTransition(fixture.initial, {
      type: "PREPARE_OPERATION",
      job_attempts: [attempt],
      consume_amendment_ids: [],
    }, 0)
    if (!prepared.ok) throw new TypeError(prepared.message)
    const admitted = await compareAndSwapCertificationGeneration({
      directory,
      identity,
      expected_certification_revision: 0,
      next_state: prepared.state,
    })
    if (admitted.kind !== "ok") throw new TypeError(admitted.message)
    const completed = fixture.extraction.completed
    if (completed.phase !== "COMPLETED") throw new TypeError("Expected completed fixture")
    const harness = createCertificationJobCrashHarness({
      directory,
      identity,
      initial_attempt: attempt,
      receipt: completed.receipt,
      boundary,
    })

    // when
    await expect(progress(await harness.current_attempt(), harness.runtime(), completed.receipt)).rejects.toThrow(`crash after ${boundary}`)
    const resumed = await progress(await harness.current_attempt(), harness.runtime(), completed.receipt)

    // then
    expect(resumed).toMatchObject({ kind: "completed", attempt: { phase: "COMPLETED" } })
    expect(harness.counts()).toEqual({ child_created: 1, prompt_sent: 1 })
  })

  test("a fresh non-caching runtime does not redispatch an already-marked prompt", async () => {
    // given
    const fixture = certificationOperationFixture()
    const attempt = preparedAttempt(fixture)
    const directory = temporaryDirectory()
    const identity = storageIdentity(fixture.initial)
    await initializeCertificationGeneration({ directory, state: fixture.initial, initialized_from_campaign_revision: 12 })
    const prepared = reduceCertificationTransition(fixture.initial, {
      type: "PREPARE_OPERATION",
      job_attempts: [attempt],
      consume_amendment_ids: [],
    }, 0)
    if (!prepared.ok) throw new TypeError(prepared.message)
    await compareAndSwapCertificationGeneration({ directory, identity, expected_certification_revision: 0, next_state: prepared.state })
    const completed = fixture.extraction.completed
    if (completed.phase !== "COMPLETED") throw new TypeError("Expected completed fixture")
    const harness = createCertificationJobCrashHarness({
      directory,
      identity,
      initial_attempt: attempt,
      receipt: completed.receipt,
      boundary: "PROMPT_APPENDED",
    })
    await expect(progress(await harness.current_attempt(), harness.runtime(), completed.receipt)).rejects.toThrow("crash after PROMPT_APPENDED")

    // when
    await progress(await harness.current_attempt(), harness.runtime(), completed.receipt)

    // then
    expect(harness.counts()).toEqual({ child_created: 1, prompt_sent: 1 })
  })
})

function progress(
  attempt: Awaited<ReturnType<ReturnType<typeof createCertificationJobCrashHarness>["current_attempt"]>>,
  runtime: ReturnType<ReturnType<typeof createCertificationJobCrashHarness>["runtime"]>,
  receipt: Parameters<typeof createCertificationJobCrashHarness>[0]["receipt"],
) {
  return progressCertificationJobAttempt({
    parent_session_id: "ses_parent1",
    attempt,
    system_content: undefined,
    user_prompt: "certification payload",
    receipt_from_output: () => receipt,
    runtime,
  })
}

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "openmath-certification-restart-"))
  directories.push(directory)
  return directory
}

function storageIdentity(state: ReturnType<typeof certificationOperationFixture>["initial"]) {
  return {
    campaign_id: state.campaign_id,
    selected_artifact: state.selected_artifact,
    certification_profile_sha256: state.certification_profile_sha256,
    initialized_from_campaign_revision: 12,
  }
}

function preparedAttempt(fixture: ReturnType<typeof certificationOperationFixture>) {
  const source = fixture.extraction.prepared
  return prepareCertificationJobAttempt({
    state: fixture.initial,
    job_id: source.job_id,
    target: source.target,
    role: source.role,
    resolved_model: source.resolved_model,
    prompt_sha256: source.prompt_sha256,
    input_sha256: source.input_sha256,
  })
}
