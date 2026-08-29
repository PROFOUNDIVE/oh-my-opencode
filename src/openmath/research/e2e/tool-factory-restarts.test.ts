import { afterEach, describe, expect, test } from "bun:test"

import { createResearchToolFactoryHarness } from "./tool-factory-harness"
import {
  FACTORY_CRASH_BOUNDARIES,
  type FactoryCrashBoundary,
  type RecoverableCampaignPhase,
} from "./restartable-factory-transport"

const cleanups: (() => void)[] = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

describe("Phase A public tool-factory restart recovery", () => {
  test.each(restartCases())("recovers %s after %s through rebuilt public factories", async (
    phase: RecoverableCampaignPhase,
    boundary: FactoryCrashBoundary,
  ) => {
    // given
    const harness = createResearchToolFactoryHarness({ tournament: "KEEP" })
    cleanups.push(harness.cleanup)

    // when
    const result = await harness.runCrashRecovery(phase, boundary)

    // then
    const jobs = expectedJobs(phase)
    expect(result.public_json.crash).toEqual({
      ok: false,
      error_code: "SUBAGENT_FAILED",
      message: `crash after ${phase}/${boundary}`,
    })
    expect(result.public_json.interrupted).toMatchObject({ ok: true, phase, status: "RUNNING" })
    expect(result.public_json.recovered).toMatchObject(expectedRecovery(phase))
    expect(result.persisted.operation_jobs.map((job) => job.phase)).toEqual(Array.from({ length: jobs }, () => "COMMITTED"))
    expect(new Set(result.persisted.operation_jobs.map((job) => job.job_id)).size).toBe(jobs)
    expect(new Set(result.persisted.operation_jobs.map((job) => job.child_session_id)).size).toBe(jobs)
    expect(result.persisted.revisions).toEqual(
      Array.from({ length: result.persisted.revision + 1 }, (_, index) => index),
    )
    expect(result.persisted.active_job_ids).toEqual([])
    expect(result.exact_once).toEqual({
      jobs,
      child_creations: jobs,
      prompt_appends: jobs,
      completion_writes: jobs,
      external_dispatches: jobs + (requiresResumeDispatch(boundary) ? 1 : 0),
    })
    expect(result.dependency_constructions).toBe(2)
  })

  test("reports explicit forbidden-operation counters", async () => {
    // given
    const harness = createResearchToolFactoryHarness({ tournament: "KEEP" })
    cleanups.push(harness.cleanup)

    // when
    const result = await harness.runToDecision("approve")

    // then
    expect(result.counts.forbidden_operations).toEqual({
      canonical_export: 0,
      authority_refinement: 0,
      continuation_schedule: 0,
      artifact_patch: 0,
      artifact_merge: 0,
    })
  })
})

function restartCases(): readonly (readonly [RecoverableCampaignPhase, FactoryCrashBoundary])[] {
  return (["DISCOVERY", "SCREENING", "TOURNAMENT", "DEEP_REFINEMENT"] as const)
    .flatMap((phase) => FACTORY_CRASH_BOUNDARIES.map((boundary) => [phase, boundary] as const))
}

function expectedJobs(phase: RecoverableCampaignPhase): number {
  return phase === "DISCOVERY" || phase === "SCREENING" ? 2 : 1
}

function requiresResumeDispatch(boundary: FactoryCrashBoundary): boolean {
  return boundary !== "OUTPUT_FETCHED" && boundary !== "COMPLETED"
}

function expectedRecovery(phase: RecoverableCampaignPhase) {
  switch (phase) {
    case "DISCOVERY": return { ok: true, phase: "SCREENING", status: "READY" }
    case "SCREENING": return { ok: true, phase: "SCREENING", status: "AWAITING_HUMAN" }
    case "TOURNAMENT": return { ok: true, phase: "DEEP_REFINEMENT", status: "READY" }
    case "DEEP_REFINEMENT": return { ok: true, phase: "PROMOTION", status: "READY" }
    default: return assertNever(phase)
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected restart phase: ${String(value)}`)
}
