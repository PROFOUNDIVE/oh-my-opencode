import { describe, expect, test } from "bun:test"

import { reduceCertificationTransition } from "../transitions"
import { ResearchCertificationStateV1Schema } from "../state/schema"
import { createExtractionCoverageRoundOrchestration } from "./extraction-coverage-orchestration"
import {
  coverageRawOutput,
  extractionRawOutput,
  prepareState,
  progressFrom,
  roundContext,
  roundState,
} from "./extraction-coverage-test-fixture"

describe("certification extraction and coverage rounds", () => {
  test("first-round PASS persists extraction before independent coverage and exposes attacks only afterward", async () => {
    let state = roundState()
    state = await execute(state, extractionRawOutput())
    expect(state).toMatchObject({ phase: "COVERAGE_REVIEW", status: "READY" })
    expect(typeof state.graphs[0]?.graph_sha256).toBe("string")

    state = await execute(state, coverageRawOutput("PASS"))

    expect(state).toMatchObject({ phase: "COUNTEREXAMPLE_ATTACK", status: "READY", coverage_reviews: [{ verdict: "PASS" }] })
    expect(state.job_attempts.map((job) => job.job_kind)).toEqual(["EXTRACTION", "COVERAGE"])
  })

  test("REVISE prepares the next extraction from the exact prior graph and findings", async () => {
    let state = await execute(roundState(), extractionRawOutput())
    state = await execute(state, coverageRawOutput("REVISE"))
    const orchestration = createExtractionCoverageRoundOrchestration({ context: roundContext(), progress_job: progressFrom(extractionRawOutput()) })

    const plan = orchestration.plan_operation(state)

    expect(plan.ok).toBe(true)
    if (!plan.ok) throw new TypeError(plan.message)
    expect(plan.payload).toMatchObject({
      prior_graph: state.graphs[0],
      prior_findings: state.coverage_reviews[0]?.findings,
      amendments: [],
    })
    expect(plan.job_attempts[0]?.target).toMatchObject({ kind: "EXTRACTION", coverage_round: 2 })
  })

  test("cap exhaustion pauses with the exact coverage-review reason", async () => {
    let state = await execute(roundState(), extractionRawOutput(), 1)

    state = await execute(state, coverageRawOutput("REVISE"), 1)

    expect(state).toMatchObject({ status: "AWAITING_HUMAN", phase: "COVERAGE_REVIEW", awaiting_reason: "COVERAGE_REVIEW_REQUIRED" })
  })

  test("INCONCLUSIVE pauses without scheduling attacks", async () => {
    let state = await execute(roundState(), extractionRawOutput())

    state = await execute(state, coverageRawOutput("INCONCLUSIVE"))

    expect(state).toMatchObject({ status: "AWAITING_HUMAN", awaiting_reason: "COVERAGE_REVIEW_REQUIRED" })
    expect(state.job_attempts.some((job) => job.job_kind === "ATTACK")).toBe(false)
  })

  test("an applicable graph amendment after INCONCLUSIVE is consumed by the next bounded extraction", async () => {
    let state = await execute(roundState(), extractionRawOutput())
    state = await execute(state, coverageRawOutput("INCONCLUSIVE"))
    const amended = reduceCertificationTransition(state, {
      type: "ADD_AMENDMENT",
      kind: "required_check",
      scope: "graph",
      content: "Re-extract the missing claim.",
    }, state.certification_revision)
    if (!amended.ok) throw new TypeError(amended.message)
    const amendment = amended.state.amendments[amended.state.amendments.length - 1]
    if (amendment === undefined) throw new TypeError("Expected graph amendment")
    const orchestration = createExtractionCoverageRoundOrchestration({ context: roundContext(), progress_job: progressFrom(extractionRawOutput()) })

    const plan = orchestration.plan_operation(amended.state)

    expect(plan.ok && plan.job_attempts[0]?.target).toMatchObject({ kind: "EXTRACTION", coverage_round: 2 })
    expect(plan.ok && plan.consume_amendment_ids).toEqual([amendment.amendment_id])
  })
})

async function execute(state: ReturnType<typeof roundState>, rawOutput: string, maxRounds = 2) {
  const orchestration = createExtractionCoverageRoundOrchestration({ context: roundContext(maxRounds), progress_job: progressFrom(rawOutput) })
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
