import { describe, expect, test } from "bun:test"

import { reduceCertificationTransition } from "../transitions"
import { ResearchCertificationStateV1Schema } from "../state/schema"
import { createExtractionCoverageRoundOrchestration } from "./extraction-coverage-orchestration"
import { buildExtractionRoundPayload } from "./extraction-coverage-payload"
import {
  coverageRawOutput,
  extractionRawOutput,
  failedProgressFrom,
  persistedProgressFrom,
  prepareState,
  progressFrom,
  roundContext,
  roundRuntime,
  roundState,
} from "./extraction-coverage-test-fixture"
import { adaptExtractionOutput } from "../adapters/extraction-output-adapter"
import type { CertificationSchedulerTransition } from "../application/certification-scheduler-contract"

describe("certification extraction and coverage failure policy", () => {
  test.each(["malformed extraction", "malformed coverage"])("blocks %s as ADAPTER_OUTPUT_INVALID", async (scenario: string) => {
    const initial = scenario === "malformed extraction" ? roundState() : await execute(roundState(), extractionRawOutput())

    const result = await execute(initial, "not-json")

    expect(result).toMatchObject({ status: "BLOCKED", blocked_reason: "ADAPTER_OUTPUT_INVALID" })
  })

  test("rejects a stale amendment instead of dispatching", () => {
    const added = reduceCertificationTransition(roundState(), {
      type: "ADD_AMENDMENT",
      kind: "required_check",
      scope: "graph",
      content: "Recheck the graph.",
    }, 0)
    if (!added.ok) throw new TypeError(added.message)
    const orchestration = createExtractionCoverageRoundOrchestration({ context: roundContext(), progress_job: progressFrom(extractionRawOutput()) })
    const plan = orchestration.plan_operation(added.state)
    if (!plan.ok) throw new TypeError(plan.message)
    const prepared = prepareState(added.state, plan.job_attempts, plan.consume_amendment_ids)
    expect(plan.payload).toEqual(buildExtractionRoundPayload(prepared, roundContext()))
    expect(plan.consume_amendment_ids).toEqual([added.state.amendments[0]?.amendment_id])
    const retracted = reduceCertificationTransition(added.state, { type: "RETRACT_AMENDMENT", amendment_id: plan.consume_amendment_ids[0] ?? "missing" }, 1)
    if (!retracted.ok) throw new TypeError(retracted.message)

    const stale = reduceCertificationTransition(retracted.state, {
      type: "PREPARE_OPERATION",
      job_attempts: plan.job_attempts,
      consume_amendment_ids: plan.consume_amendment_ids,
    }, retracted.state.certification_revision)

    expect(stale).toMatchObject({ ok: false, error_code: "VALIDATION_ERROR" })
  })

  test("restart after graph commit prepares coverage without redispatching extraction", async () => {
    const extracted = await execute(roundState(), extractionRawOutput())
    const orchestration = createExtractionCoverageRoundOrchestration({ context: roundContext(), progress_job: progressFrom(coverageRawOutput("PASS")) })

    const first = orchestration.plan_operation(extracted)
    const restarted = orchestration.plan_operation(extracted)

    expect(first).toEqual(restarted)
    expect(first.ok && first.job_attempts[0]?.target.kind).toBe("COVERAGE")
    expect(extracted.job_attempts.filter((job) => job.job_kind === "EXTRACTION")).toHaveLength(1)
  })

  test("restart commits an already-persisted COMPLETED extraction without redispatch", async () => {
    const rawOutput = extractionRawOutput()
    const state = roundState()
    const adapted = adaptExtractionOutput(rawOutput, { sources: roundContext().sources, max_obligations: 8 })
    if (!adapted.ok) throw new TypeError(adapted.error.message)
    const orchestration = createExtractionCoverageRoundOrchestration({
      context: roundContext(),
      progress_job: persistedProgressFrom(rawOutput, { kind: "EXTRACTION", graph_sha256: adapted.graph.graph_sha256 }),
      create_job_runtime: () => roundRuntime(rawOutput),
    })
    const plan = orchestration.plan_operation(state)
    if (!plan.ok) throw new TypeError(plan.message)
    let current = prepareState(state, plan.job_attempts)

    const result = await orchestration.run_operation(operationInput(current, (next) => { current = next }))

    expect(result).toEqual({ ok: true })
    expect(current).toMatchObject({ status: "READY", phase: "COVERAGE_REVIEW", graphs: [{ graph_sha256: adapted.graph.graph_sha256 }] })
  })

  test("runtime inspection failure blocks with RECONCILIATION_AMBIGUOUS", async () => {
    const state = roundState()
    const orchestration = createExtractionCoverageRoundOrchestration({
      context: roundContext(),
      progress_job: async () => { throw new TypeError("inspection failed") },
    })
    const plan = orchestration.plan_operation(state)
    if (!plan.ok) throw new TypeError(plan.message)
    let current = prepareState(state, plan.job_attempts)

    const result = await orchestration.run_operation(operationInput(current, (next) => { current = next }))

    expect(result).toEqual({ ok: true })
    expect(current).toMatchObject({ status: "BLOCKED", blocked_reason: "RECONCILIATION_AMBIGUOUS" })
  })

  test("dispatch failure blocks with DISPATCH_FAILED", async () => {
    const state = roundState()
    const orchestration = createExtractionCoverageRoundOrchestration({ context: roundContext(), progress_job: failedProgressFrom("DISPATCH_FAILED") })
    const plan = orchestration.plan_operation(state)
    if (!plan.ok) throw new TypeError(plan.message)
    let current = prepareState(state, plan.job_attempts)

    const result = await orchestration.run_operation(operationInput(current, (next) => { current = next }))

    expect(result).toEqual({ ok: true })
    expect(current).toMatchObject({ status: "BLOCKED", blocked_reason: "DISPATCH_FAILED" })
  })

  test("stale frozen context is rejected before job preparation", () => {
    const context = { ...roundContext(), reference_sha256: "f".repeat(64) }
    const orchestration = createExtractionCoverageRoundOrchestration({ context, progress_job: progressFrom(extractionRawOutput()) })

    const plan = orchestration.plan_operation(roundState())

    expect(plan).toMatchObject({ ok: false, error_code: "PROFILE_HASH_MISMATCH" })
  })
})

async function execute(state: ReturnType<typeof roundState>, rawOutput: string) {
  const orchestration = createExtractionCoverageRoundOrchestration({ context: roundContext(), progress_job: progressFrom(rawOutput) })
  const plan = orchestration.plan_operation(state)
  if (!plan.ok) throw new TypeError(plan.message)
  let current = prepareState(state, plan.job_attempts, plan.consume_amendment_ids)
  const result = await orchestration.run_operation({
    state: current,
    operation_owner: { operation_id: "operation-1", token: "token-1", pid: process.pid, started_at: "2026-08-30T00:00:00.000Z" },
    recovered_owner: null,
    persist_job_attempt: async () => ({ ok: false, error_code: "STORAGE_WRITE_FAILED", message: "unused" }),
    block_reconciliation: async () => ({ ok: false, error_code: "STORAGE_WRITE_FAILED", message: "unused" }),
    commit_transition: async (event) => {
      if (event.type === "COMMIT_EXTRACTION" || event.type === "COMMIT_COVERAGE") {
        const completed = event.completed_jobs[0]
        if (completed === undefined) throw new TypeError("Expected completed round job")
        current = ResearchCertificationStateV1Schema.parse({
          ...current,
          certification_revision: completed.phase_revision,
          job_attempts: current.job_attempts.map((job) => job.job_id === completed.job_id ? completed : job),
        })
      }
      const transition = reduceCertificationTransition(current, event, current.certification_revision)
      if (!transition.ok) return { kind: "error", error_code: transition.error_code, message: transition.message }
      current = transition.state
      return { kind: "ok", state: current }
    },
  })
  if (!result.ok) throw new TypeError(result.message)
  return current
}

function operationInput(
  initial: ReturnType<typeof prepareState>,
  update: (state: ReturnType<typeof prepareState>) => void,
) {
  let current = initial
  return {
    state: initial,
    operation_owner: { operation_id: "operation-1", token: "token-1", pid: process.pid, started_at: "2026-08-30T00:00:00.000Z" },
    recovered_owner: null,
    persist_job_attempt: async () => ({ ok: false as const, error_code: "STORAGE_WRITE_FAILED" as const, message: "unused" }),
    block_reconciliation: async () => ({ ok: false as const, error_code: "STORAGE_WRITE_FAILED" as const, message: "unused" }),
    commit_transition: async (event: CertificationSchedulerTransition) => {
      if (event.type === "COMMIT_EXTRACTION" || event.type === "COMMIT_COVERAGE") {
        const completed = event.completed_jobs[0]
        if (completed === undefined) throw new TypeError("Expected completed round job")
        current = ResearchCertificationStateV1Schema.parse({
          ...current,
          certification_revision: completed.phase_revision,
          job_attempts: current.job_attempts.map((job) => job.job_id === completed.job_id ? completed : job),
        })
      }
      const transition = reduceCertificationTransition(current, event, current.certification_revision)
      if (!transition.ok) return { kind: "error" as const, error_code: transition.error_code, message: transition.message }
      current = transition.state
      update(current)
      return { kind: "ok" as const, state: current }
    },
  }
}
