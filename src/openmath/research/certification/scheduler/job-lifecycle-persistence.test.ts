import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { reduceCertificationTransition } from "../transitions/reduce-transition"
import { certificationOperationFixture } from "../transitions/operation-test-fixture"
import {
  compareAndSwapCertificationGeneration,
  initializeCertificationGeneration,
  readCertificationGeneration,
} from "../storage"
import { persistCertificationJobLifecycle } from "./persist-certification-job-lifecycle"

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("certification job lifecycle persistence", () => {
  test("persists every boundary before committing exact output and evidence", async () => {
    // given
    const fixture = certificationOperationFixture()
    const directory = temporaryDirectory()
    const identity = storageIdentity(fixture.initial)
    const initialized = await initializeCertificationGeneration({
      directory,
      state: fixture.initial,
      initialized_from_campaign_revision: 12,
    })
    if (initialized.kind !== "ok") throw new TypeError(initialized.message)
    const prepared = reduceCertificationTransition(fixture.initial, {
      type: "PREPARE_OPERATION",
      job_attempts: [fixture.extraction.prepared],
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
    const completedFixture = fixture.extraction.completed
    if (completedFixture.phase !== "COMPLETED") throw new TypeError("Expected completed extraction fixture")

    // when
    const session = await persistCertificationJobLifecycle({
      directory,
      identity,
      update: {
        phase: "SESSION_CREATED",
        job_id: completedFixture.job_id,
        child_session_id: completedFixture.child_session_id,
      },
    })
    const prompt = await persistCertificationJobLifecycle({
      directory,
      identity,
      update: {
        phase: "PROMPT_SENT",
        job_id: completedFixture.job_id,
        child_session_id: completedFixture.child_session_id,
      },
    })
    const output = await persistCertificationJobLifecycle({
      directory,
      identity,
      update: {
        phase: "COMPLETED",
        job_id: completedFixture.job_id,
        child_session_id: completedFixture.child_session_id,
        raw_output_sha256: completedFixture.raw_output_sha256,
        receipt: completedFixture.receipt,
      },
    })
    if (!output.ok || output.attempt.phase !== "COMPLETED") throw new TypeError("Expected durable completion")
    const current = await readCertificationGeneration({ directory, ...identity })
    if (current.kind !== "ok") throw new TypeError(current.kind === "error" ? current.message : "Certification not started")
    const committed = reduceCertificationTransition(current.state, {
      type: "COMMIT_EXTRACTION",
      completed_jobs: [output.attempt],
      graph: fixture.graph,
      evidence_receipts: [{
        ...fixture.extraction.evidence,
        certification_revision: current.state.certification_revision + 1,
        child_session_id: output.attempt.child_session_id,
        output_sha256: output.attempt.raw_output_sha256,
      }],
    }, current.state.certification_revision)
    if (!committed.ok) throw new TypeError(committed.message)
    const receipt = await compareAndSwapCertificationGeneration({
      directory,
      identity,
      expected_certification_revision: current.state.certification_revision,
      next_state: committed.state,
    })

    // then
    expect(session).toMatchObject({ ok: true, attempt: { phase: "SESSION_CREATED", phase_revision: 2 } })
    expect(prompt).toMatchObject({ ok: true, attempt: { phase: "PROMPT_SENT", phase_revision: 3 } })
    expect(output).toMatchObject({ ok: true, attempt: { phase: "COMPLETED", phase_revision: 4 } })
    expect(receipt).toMatchObject({
      kind: "ok",
      state: {
        certification_revision: 5,
        status: "READY",
        job_attempts: [{ phase: "COMMITTED", phase_revision: 5 }],
      },
    })
  })

  test("rejects a prompt receipt before a session receipt", async () => {
    // given
    const fixture = certificationOperationFixture()
    const directory = temporaryDirectory()
    const identity = storageIdentity(fixture.initial)
    await initializeCertificationGeneration({ directory, state: fixture.initial, initialized_from_campaign_revision: 12 })
    const prepared = reduceCertificationTransition(fixture.initial, {
      type: "PREPARE_OPERATION",
      job_attempts: [fixture.extraction.prepared],
      consume_amendment_ids: [],
    }, 0)
    if (!prepared.ok) throw new TypeError(prepared.message)
    await compareAndSwapCertificationGeneration({ directory, identity, expected_certification_revision: 0, next_state: prepared.state })

    // when
    const result = await persistCertificationJobLifecycle({
      directory,
      identity,
      update: { phase: "PROMPT_SENT", job_id: fixture.extraction.prepared.job_id, child_session_id: "ses_child1" },
    })

    // then
    expect(result).toEqual({
      ok: false,
      error_code: "RECONCILIATION_AMBIGUOUS",
      message: "Cannot persist PROMPT_SENT after PREPARED",
    })
  })
})

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "openmath-certification-job-"))
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
