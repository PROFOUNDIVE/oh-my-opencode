import { afterEach, expect, test } from "bun:test"

import { CertificationJobAttemptSchema } from "../state/jobs"
import { completeCertificationOperation } from "../transitions/operation-jobs"
import { reduceCertificationTransition } from "../transitions/reduce-transition"
import { certificationOperationFixture } from "../transitions/operation-test-fixture"
import { readCertificationGeneration } from "../storage"
import {
  certificationJobProgressInput,
  certificationJobRuntime,
  removeCertificationJobTestDirectories,
  runningCertificationJobSetup,
} from "./certification-job-operation-test-fixture"
import { persistCertificationJobLifecycle } from "./persist-certification-job-lifecycle"
import { progressCertificationJobAttempt } from "./progress-certification-job-attempt"

afterEach(() => {
  removeCertificationJobTestDirectories()
})

test("cannot commit a job before its completion receipt is durably persisted", async () => {
  // given
  const setup = await runningCertificationJobSetup()
  await persistCertificationJobLifecycle({
    directory: setup.directory,
    identity: setup.identity,
    update: { phase: "SESSION_CREATED", job_id: setup.attempt.job_id, child_session_id: "ses_child1" },
  })
  await persistCertificationJobLifecycle({
    directory: setup.directory,
    identity: setup.identity,
    update: { phase: "PROMPT_SENT", job_id: setup.attempt.job_id, child_session_id: "ses_child1" },
  })
  const current = await readCertificationGeneration({ directory: setup.directory, ...setup.identity })
  if (current.kind !== "ok") throw new TypeError(current.kind === "error" ? current.message : "Certification not started")
  const promptSent = current.state.job_attempts[0]
  if (promptSent?.phase !== "PROMPT_SENT") throw new TypeError("Expected prompt-sent job")
  const unpersistedCompletion = CertificationJobAttemptSchema.parse({
    ...promptSent,
    phase: "COMPLETED",
    phase_revision: current.state.certification_revision + 1,
    raw_output_sha256: "a".repeat(64),
    receipt: setup.receipt,
  })

  // when
  const result = completeCertificationOperation(current.state, [unpersistedCompletion])

  // then
  expect(result).toMatchObject({ ok: false, result: { error_code: "VALIDATION_ERROR" } })
})

test("resumes commit without redispatch after the completion receipt is durable", async () => {
  // given
  const setup = await runningCertificationJobSetup()
  await persistCertificationJobLifecycle({
    directory: setup.directory,
    identity: setup.identity,
    update: { phase: "SESSION_CREATED", job_id: setup.attempt.job_id, child_session_id: "ses_child1" },
  })
  await persistCertificationJobLifecycle({
    directory: setup.directory,
    identity: setup.identity,
    update: { phase: "PROMPT_SENT", job_id: setup.attempt.job_id, child_session_id: "ses_child1" },
  })
  const persisted = await persistCertificationJobLifecycle({
    directory: setup.directory,
    identity: setup.identity,
    update: {
      phase: "COMPLETED",
      job_id: setup.attempt.job_id,
      child_session_id: "ses_child1",
      raw_output_sha256: "a".repeat(64),
      receipt: setup.receipt,
    },
  })
  if (!persisted.ok || persisted.attempt.phase !== "COMPLETED") throw new TypeError("Expected durable completion")
  let dispatches = 0
  const runtime = certificationJobRuntime(setup, {
    dispatch: async () => {
      dispatches += 1
      return { ok: true, session_id: "ses_child1", text: "unexpected" }
    },
  })

  // when
  const resumed = await progressCertificationJobAttempt(certificationJobProgressInput(persisted.attempt, runtime, setup.receipt))
  const committed = completeCertificationOperation(persisted.state, [persisted.attempt])

  // then
  expect(resumed).toMatchObject({ kind: "completed", attempt: { phase: "COMPLETED" } })
  expect(committed).toMatchObject({ ok: true, committed_jobs: [{ phase: "COMMITTED" }] })
  expect(dispatches).toBe(0)
})

test("rejects a completed job whose immutable campaign identity changed", () => {
  // given
  const fixture = certificationOperationFixture()
  const prepared = reduceCertificationTransition(fixture.initial, {
    type: "PREPARE_OPERATION",
    job_attempts: [fixture.extraction.prepared],
    consume_amendment_ids: [],
  }, 0)
  if (!prepared.ok) throw new TypeError(prepared.message)
  const mismatched = CertificationJobAttemptSchema.parse({
    ...fixture.extraction.completed,
    campaign_id: "campaign-b",
  })

  // when
  const result = completeCertificationOperation(prepared.state, [mismatched])

  // then
  expect(result).toMatchObject({ ok: false, result: { error_code: "VALIDATION_ERROR" } })
})
