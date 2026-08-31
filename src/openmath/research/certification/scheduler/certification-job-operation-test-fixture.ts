import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { z } from "zod"

import {
  CertificationJobReceiptSchema,
  type CertificationJobAttempt,
} from "../state/jobs"
import { reduceCertificationTransition } from "../transitions/reduce-transition"
import { certificationOperationFixture } from "../transitions/operation-test-fixture"
import {
  compareAndSwapCertificationGeneration,
  initializeCertificationGeneration,
  readCertificationGeneration,
  type CertificationStorageIdentityInput,
} from "../storage"
import { blockCertificationJobOperation } from "./block-certification-job-operation"
import type { CertificationJobRuntime } from "./certification-job-runtime-types"
import { persistCertificationJobLifecycle } from "./persist-certification-job-lifecycle"
import { prepareCertificationJobAttempt } from "./prepare-certification-job-attempt"

type TestReceipt = z.infer<typeof CertificationJobReceiptSchema>

export type CertificationJobTestSetup = Readonly<{
  readonly directory: string
  readonly identity: CertificationStorageIdentityInput
  readonly attempt: CertificationJobAttempt
  readonly receipt: TestReceipt
}>

const directories: string[] = []

export function removeCertificationJobTestDirectories(): void {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
}

export async function runningCertificationJobSetup(): Promise<CertificationJobTestSetup> {
  const fixture = certificationOperationFixture()
  const source = fixture.extraction.prepared
  const attempt = prepareCertificationJobAttempt({
    state: fixture.initial,
    job_id: source.job_id,
    target: source.target,
    role: source.role,
    resolved_model: source.resolved_model,
    prompt_sha256: source.prompt_sha256,
    input_sha256: source.input_sha256,
  })
  const directory = mkdtempSync(join(tmpdir(), "openmath-certification-failure-"))
  directories.push(directory)
  const identity = {
    campaign_id: fixture.initial.campaign_id,
    selected_artifact: fixture.initial.selected_artifact,
    certification_profile_sha256: fixture.initial.certification_profile_sha256,
    initialized_from_campaign_revision: 12,
  }
  await initializeCertificationGeneration({ directory, state: fixture.initial, initialized_from_campaign_revision: 12 })
  const prepared = reduceCertificationTransition(fixture.initial, {
    type: "PREPARE_OPERATION",
    job_attempts: [attempt],
    consume_amendment_ids: [],
  }, 0)
  if (!prepared.ok) throw new TypeError(prepared.message)
  const persisted = await compareAndSwapCertificationGeneration({
    directory,
    identity,
    expected_certification_revision: 0,
    next_state: prepared.state,
  })
  if (persisted.kind !== "ok") throw new TypeError(persisted.message)
  const completed = fixture.extraction.completed
  if (completed.phase !== "COMPLETED") throw new TypeError("Expected completed fixture")
  return { directory, identity, attempt, receipt: completed.receipt }
}

export async function promptSentCertificationJobSetup(): Promise<CertificationJobTestSetup> {
  const setup = await runningCertificationJobSetup()
  await persistCertificationJobLifecycle({
    directory: setup.directory,
    identity: setup.identity,
    update: { phase: "SESSION_CREATED", job_id: setup.attempt.job_id, child_session_id: "ses_child1" },
  })
  const prompt = await persistCertificationJobLifecycle({
    directory: setup.directory,
    identity: setup.identity,
    update: { phase: "PROMPT_SENT", job_id: setup.attempt.job_id, child_session_id: "ses_child1" },
  })
  if (!prompt.ok || prompt.attempt.phase !== "PROMPT_SENT") throw new TypeError("Expected prompt receipt")
  return { ...setup, attempt: prompt.attempt }
}

export function certificationJobRuntime(
  setup: CertificationJobTestSetup,
  overrides: Partial<CertificationJobRuntime>,
): CertificationJobRuntime {
  return {
    ...inertCertificationJobRuntime(async () => ({ ok: true, session_id: "ses_child1", text: "output" })),
    persist_job_attempt: (update) => persistCertificationJobLifecycle({ directory: setup.directory, identity: setup.identity, update }),
    block_reconciliation: (request) => blockCertificationJobOperation({ directory: setup.directory, identity: setup.identity, ...request }),
    ...overrides,
  }
}

export function inertCertificationJobRuntime(dispatch: CertificationJobRuntime["dispatch"]): CertificationJobRuntime {
  return {
    verify_operation_owner: async () => ({ ok: true }),
    persist_job_attempt: async () => ({ ok: false, error_code: "STORAGE_WRITE_FAILED", message: "unused" }),
    block_reconciliation: async () => ({ ok: false, error_code: "STORAGE_WRITE_FAILED", message: "unused" }),
    list_children: async () => [],
    get_session: async () => ({ title: "unused" }),
    list_messages: async () => [],
    dispatch,
  }
}

export function certificationJobProgressInput(
  attempt: CertificationJobAttempt,
  runtime: CertificationJobRuntime,
  receipt: TestReceipt,
) {
  return {
    parent_session_id: "ses_parent1",
    attempt,
    system_content: undefined,
    user_prompt: "payload",
    receipt_from_output: () => receipt,
    runtime,
  }
}

export async function currentCertificationJobStatus(setup: CertificationJobTestSetup) {
  const current = await readCertificationGeneration({ directory: setup.directory, ...setup.identity })
  if (current.kind !== "ok") throw new TypeError(current.kind === "error" ? current.message : "Certification not started")
  return { status: current.state.status, blocked_reason: current.state.blocked_reason }
}
