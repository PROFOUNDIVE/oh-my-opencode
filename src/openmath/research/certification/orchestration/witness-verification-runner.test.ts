import { describe, expect, test } from "bun:test"

import { sha256 } from "../../../workflow/stage-runner/sha256"
import { CertificationJobAttemptSchema, type CertificationJobAttempt } from "../state/jobs"
import { ResearchCertificationStateV1Schema } from "../state/schema"
import { reduceCertificationTransition } from "../transitions"
import type { CertificationJobProgressInput, CertificationJobProgressResult } from "../scheduler"
import type { FailedCertificationJob } from "../scheduler/certification-job-progress-types"
import { createWitnessVerificationOrchestration } from "./witness-verification-orchestration"
import { readyWitnessState, witnessContext } from "./witness-verification-planner.test"

describe("witness verification orchestration", () => {
  test("commits rejected and inconclusive outcomes with exact witness job and evidence provenance", async () => {
    // given
    const rejected = await executeWitness("REJECTED")
    const inconclusive = await executeWitness("INCONCLUSIVE")

    // when
    const records = [rejected, inconclusive].map((state) => state.witness_verifications[0])
    const receipts = [rejected, inconclusive].map((state) => state.evidence_receipts[state.evidence_receipts.length - 1])

    // then
    expect([[rejected.status, rejected.blocked_reason], [inconclusive.status, inconclusive.blocked_reason]])
      .toEqual([["READY", null], ["READY", null]])
    expect(records.map((record) => record?.outcome)).toEqual(["REJECTED", "INCONCLUSIVE"])
    const jobs = [rejected, inconclusive].map((state) => state.job_attempts.find((job) => job.job_kind === "WITNESS"))
    expect(jobs.map((job) => job && ({ revision: job.phase_revision, role: job.role, model: job.resolved_model,
      prompt: job.prompt_sha256, input: job.input_sha256, target: job.target }))).toEqual([
      jobProjection(rejected), jobProjection(inconclusive),
    ])
    expect(receipts.map((receipt) => receipt && ({
      job_id: receipt.job_id,
      job_kind: receipt.job_kind,
      result_id: receipt.result_id,
      artifact_sha256: receipt.artifact_sha256,
      graph_sha256: receipt.graph_sha256,
      prompt_sha256: receipt.prompt_sha256,
      input_sha256: receipt.input_sha256,
      output_sha256: receipt.output_sha256,
      child_session_id: receipt.child_session_id,
      resolved_model: receipt.resolved_model,
    }))).toEqual([receiptProjection(rejected), receiptProjection(inconclusive)])
  })

  test("keeps a confirmed witness visible and uses a fresh verifier session instead of the attacker session", async () => {
    // given
    const initial = readyWitnessState()
    const attackJob = initial.job_attempts.find((job) => job.job_kind === "ATTACK" && job.phase === "COMMITTED")
    const attackSession = attackJob?.phase === "COMMITTED" ? attackJob.child_session_id : undefined
    let preparedWasFresh = false

    // when
    const state = await executeWitness("CONFIRMED", (input) => {
      preparedWasFresh = input.attempt.phase === "PREPARED" && !("child_session_id" in input.attempt)
    })

    // then
    expect(preparedWasFresh).toBe(true)
    expect(state.witness_verifications[0]?.outcome).toBe("CONFIRMED")
    const witnessJob = state.job_attempts.find((job) => job.job_kind === "WITNESS" && job.phase === "COMMITTED")
    expect(witnessJob?.phase === "COMMITTED" ? witnessJob.child_session_id : undefined).not.toBe(attackSession)
  })

  test("maps malformed and failed verifier work to typed operation blocking not inconclusive", async () => {
    // given
    const cases: readonly CertificationJobProgressResult["kind"][] = ["failed", "error"]

    // when
    const results = await Promise.all(cases.map((kind) => executeFailure(kind)))

    // then
    expect(results.map((state) => [state.status, state.blocked_reason, state.witness_verifications.length])).toEqual([
      ["BLOCKED", "ADAPTER_OUTPUT_INVALID", 0],
      ["BLOCKED", "STORAGE_READ_FAILED", 0],
    ])
  })

  test("blocks missing or ambiguous completed output recovery without redispatch", async () => {
    // given
    const variants = [[], [{ role: "assistant", text: '{"outcome":"REJECTED"}' }, { role: "assistant", text: '{"outcome":"REJECTED"}' }]]

    // when
    const results = await Promise.all(variants.map((messages) => executeRecovered(messages)))

    // then
    expect(results.every((state) => state.status === "BLOCKED"
      && state.blocked_reason === "RECONCILIATION_AMBIGUOUS"
      && state.witness_verifications.length === 0)).toBe(true)
  })
})

async function executeWitness(outcome: "CONFIRMED" | "REJECTED" | "INCONCLUSIVE", inspect?: (input: CertificationJobProgressInput) => void) {
  const rawOutput = `{"outcome":"${outcome}"}`
  return execute(progressFrom(rawOutput, inspect), [{ role: "assistant", text: rawOutput }])
}

async function execute(
  progress: (input: CertificationJobProgressInput) => Promise<CertificationJobProgressResult>,
  messages: readonly Readonly<{ readonly role: string; readonly text: string }>[] = [{ role: "assistant", text: "unused" }],
) {
  const orchestration = createWitnessVerificationOrchestration({
    context: witnessContext(),
    progress_job: progress,
    create_job_runtime: () => witnessRuntime(messages),
  })
  const plan = orchestration.plan_operation(readyWitnessState())
  if (!plan.ok) throw new TypeError(plan.message)
  const prepared = reduceCertificationTransition(readyWitnessState(), {
    type: "PREPARE_OPERATION", job_attempts: plan.job_attempts, consume_amendment_ids: [],
  }, readyWitnessState().certification_revision)
  if (!prepared.ok) throw new TypeError(prepared.message)
  let current = prepared.state
  const result = await orchestration.run_operation(operationInput(current, messages, async (event) => {
    if (event.type === "COMMIT_WITNESSES") current = persistCompleted(current, event.completed_jobs[0])
    const transition = reduceCertificationTransition(current, event, current.certification_revision)
    if (!transition.ok) return { kind: "error" as const, error_code: transition.error_code, message: transition.message }
    current = transition.state
    return { kind: "ok" as const, state: current }
  }))
  if (!result.ok) throw new TypeError(result.message)
  return current
}

function progressFrom(rawOutput: string, inspect?: (input: CertificationJobProgressInput) => void) {
  return async (input: CertificationJobProgressInput): Promise<CertificationJobProgressResult> => {
    inspect?.(input)
    if (input.attempt.target.kind !== "WITNESS") throw new TypeError("Expected witness target")
    const completed = CertificationJobAttemptSchema.parse({
      ...input.attempt,
      phase: "COMPLETED",
      phase_revision: input.attempt.phase_revision + 1,
      child_session_id: "ses_freshwitness",
      raw_output_sha256: sha256(rawOutput),
      receipt: { kind: "WITNESS", witness_verification_id: input.attempt.target.witness_verification_id },
    })
    if (completed.phase !== "COMPLETED" || completed.receipt.kind === "ERROR") throw new TypeError("Expected witness completion")
    return { kind: "completed", attempt: completed }
  }
}

async function executeFailure(kind: CertificationJobProgressResult["kind"]) {
  return execute(async (input): Promise<CertificationJobProgressResult> => {
    const failed = completedError(input)
    if (kind === "failed") return { kind, attempt: failed }
    if (kind === "blocked") return { kind, reason: "RECONCILIATION_AMBIGUOUS", evidence: { kind: "MISSING_PROMPT_MARKER", child_session_id: "ses_missing" } }
    if (kind === "error") return { kind, error_code: "STORAGE_READ_FAILED", message: "missing verifier work" }
    throw new TypeError("Unexpected failure case")
  })
}

async function executeRecovered(messages: readonly Readonly<{ readonly role: string; readonly text: string }>[]) {
  const raw = '{"outcome":"REJECTED"}'
  return execute(async (input) => {
    const completed = CertificationJobAttemptSchema.parse({ ...input.attempt, phase: "COMPLETED", phase_revision: input.attempt.phase_revision + 1,
      child_session_id: "ses_recovered1", raw_output_sha256: sha256(raw), receipt: { kind: "WITNESS", witness_verification_id: "witness-0001" } })
    if (completed.phase !== "COMPLETED" || completed.receipt.kind === "ERROR") throw new TypeError("Expected recovered completion")
    return { kind: "completed", attempt: completed }
  }, messages)
}

function completedError(input: CertificationJobProgressInput): FailedCertificationJob {
  const completed = CertificationJobAttemptSchema.parse({ ...input.attempt, phase: "COMPLETED", phase_revision: input.attempt.phase_revision + 1,
    child_session_id: "ses_failed1", raw_output_sha256: sha256("bad"), receipt: { kind: "ERROR", error_code: "ADAPTER_OUTPUT_INVALID", message: "bad" } })
  if (completed.phase !== "COMPLETED" || completed.receipt.kind !== "ERROR") throw new TypeError("Expected failed completion")
  return { ...completed, receipt: completed.receipt }
}

function operationInput(state: ReturnType<typeof readyWitnessState>, _messages: readonly Readonly<{ readonly role: string; readonly text: string }>[], commit_transition: Parameters<ReturnType<typeof createWitnessVerificationOrchestration>["run_operation"]>[0]["commit_transition"]) {
  return { state, operation_owner: { operation_id: "operation-1", token: "token-1", pid: process.pid, started_at: "2026-08-30T00:00:00.000Z" }, recovered_owner: null,
    persist_job_attempt: async () => ({ ok: false as const, error_code: "STORAGE_WRITE_FAILED" as const, message: "unused" }),
    block_reconciliation: async () => ({ ok: false as const, error_code: "STORAGE_WRITE_FAILED" as const, message: "unused" }), commit_transition }
}

function persistCompleted(state: ReturnType<typeof readyWitnessState>, completed: CertificationJobAttempt | undefined) {
  if (completed === undefined || completed.phase !== "COMPLETED") throw new TypeError("Missing completed witness")
  return ResearchCertificationStateV1Schema.parse({ ...state, certification_revision: completed.phase_revision,
    job_attempts: state.job_attempts.map((job) => job.job_id === completed.job_id ? completed : job) })
}

function receiptProjection(state: Awaited<ReturnType<typeof executeWitness>>) {
  const job = state.job_attempts.find((candidate) => candidate.job_kind === "WITNESS" && candidate.phase === "COMMITTED")
  if (job?.phase !== "COMMITTED" || job.target.kind !== "WITNESS" || job.receipt.kind !== "WITNESS") throw new TypeError("Missing committed witness")
  return { job_id: job.job_id, job_kind: job.job_kind, result_id: job.receipt.witness_verification_id,
    artifact_sha256: job.target.artifact_sha256, graph_sha256: job.target.graph_sha256, prompt_sha256: job.prompt_sha256,
    input_sha256: job.input_sha256, output_sha256: job.raw_output_sha256, child_session_id: job.child_session_id, resolved_model: job.resolved_model }
}

function jobProjection(state: Awaited<ReturnType<typeof executeWitness>>) {
  const job = state.job_attempts.find((candidate) => candidate.job_kind === "WITNESS")
  if (job === undefined) throw new TypeError("Missing witness job")
  return { revision: job.phase_revision, role: job.role, model: job.resolved_model,
    prompt: job.prompt_sha256, input: job.input_sha256, target: job.target }
}

function witnessRuntime(messages: readonly Readonly<{ readonly role: string; readonly text: string }>[]) {
  const unavailable = async () => { throw new TypeError("Unused witness runtime operation") }
  return { verify_operation_owner: async () => ({ ok: true as const }), persist_job_attempt: unavailable,
    block_reconciliation: unavailable, list_children: unavailable, get_session: unavailable,
    list_messages: async () => messages, dispatch: unavailable }
}
