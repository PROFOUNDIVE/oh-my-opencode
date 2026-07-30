import { afterEach, describe, expect, test } from "bun:test"

import { createWorkflowE2EHarness } from "./e2e-fixture"

const harnesses: ReturnType<typeof createWorkflowE2EHarness>[] = []

afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.cleanup()
})

describe("OpenMath workflow end to end failures", () => {
  test("returns persisted public errors for malformed review output, stale revision, and rejected references", async () => {
    const harness = createWorkflowE2EHarness(["MALFORMED"])
    harnesses.push(harness)

    const result = await harness.runFailureWorkflow()

    expect(result.malformed).toMatchObject({ ok: true, status: "AWAITING_HUMAN", stage: "REVIEW" })
    expect(result.malformed.next_actions).toEqual([
      { action: "amend", required_state_revision: result.malformed.state_revision, reason: "INPUT_CHANGE_REQUIRED" },
      { action: "reload_prompts", required_state_revision: result.malformed.state_revision, reason: "INPUT_CHANGE_REQUIRED" },
      { action: "reload_references", required_state_revision: result.malformed.state_revision, reason: "INPUT_CHANGE_REQUIRED" },
      { action: "abort", required_state_revision: result.malformed.state_revision, reason: "INPUT_CHANGE_REQUIRED" },
    ])
    expect(result.malformed_record).toMatchObject({ error_code: "ADAPTER_OUTPUT_INVALID" })
    expect(result.stale).toMatchObject({ ok: false, error_code: "STALE_STATE_REVISION", current_state_revision: 0 })
    expect(result.rejected_path).toMatchObject({ ok: false, error_code: "REFERENCE_SOURCE_ERROR" })
  })

  test("blocks ambiguous crash reconciliation and commits a resumed crash attempt exactly once", async () => {
    const harness = createWorkflowE2EHarness(["PASS"])
    harnesses.push(harness)

    const result = await harness.runCrashWorkflow()

    expect(result.blocked).toMatchObject({ ok: true, status: "BLOCKED", stage: "SOLVE" })
    expect(result.blocked.next_actions).toEqual([
      { action: "step_one_stage", required_state_revision: result.blocked.state_revision, reason: "RECONCILIATION_BLOCKED" },
      { action: "abort", required_state_revision: result.blocked.state_revision, reason: "RECONCILIATION_BLOCKED" },
    ])
    expect(result.blocked_record).toMatchObject({ error_code: "RECONCILIATION_BLOCKED" })
    expect(result.resumed).toMatchObject({ ok: true, status: "READY", stage: "REVIEW" })
    expect(result.resumed_attempts.filter((attempt) => attempt.phase === "COMMITTED")).toHaveLength(1)
    expect(result.resumed_records.filter((record) => record.outcome === "COMPLETED")).toHaveLength(1)
  })
})
