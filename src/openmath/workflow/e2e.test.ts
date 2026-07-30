import { afterEach, describe, expect, test } from "bun:test"

import { createWorkflowE2EHarness, writeWorkflowE2EEvidence } from "./e2e-fixture"

const harnesses: ReturnType<typeof createWorkflowE2EHarness>[] = []

afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.cleanup()
})

describe("OpenMath workflow end to end", () => {
  test("completes five reviews through checkpoints, amendment, reload, and restart", async () => {
    const harness = createWorkflowE2EHarness(["REVISE", "REVISE", "REVISE", "PASS", "PASS"])
    harnesses.push(harness)

    const result = await harness.runSuccessWorkflow()

    expect(result.started).toMatchObject({ ok: true, state_revision: 0, status: "READY", stage: "SOLVE" })
    expect(result.reviewOne.next_actions).toEqual(expect.arrayContaining([
      { action: "amend", required_state_revision: result.reviewOne.state_revision, reason: "CHECKPOINT_PAUSED" },
      { action: "reload_references", required_state_revision: result.reviewOne.state_revision, reason: "CHECKPOINT_PAUSED" },
      { action: "step_to_checkpoint", required_state_revision: result.reviewOne.state_revision, reason: "CHECKPOINT_PAUSED" },
    ]))
    expect(result.amended.state_revision).toBe(result.reviewOne.state_revision + 1)
    expect(result.reloaded.state_revision).toBe(result.reviewTwo.state_revision + 1)
    expect(result.reloaded.reference_version).toBe(result.initial_reference_version + 1)
    expect(result.reloaded.reference_hash).not.toBe(result.initial_reference_hash)
    expect(result.reloaded.prompt_hash).toBe(result.initial_prompt_hash)
    expect(result.restarted.next_actions).toEqual(expect.arrayContaining([
      { action: "step_to_checkpoint", required_state_revision: result.restarted.state_revision, reason: "CHECKPOINT_PAUSED" },
    ]))
    expect(result.final).toMatchObject({ ok: true, status: "PASSED", stage: null, next_actions: [] })
    expect(result.final_state).toMatchObject({ completed_review_rounds: 5, consecutive_passes: 2, latest_review: { verdict: "PASS" } })
    expect(result.final_state.artifact?.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(result.final_state.stage_history.filter((record) => record.stage === "REVIEW")).toHaveLength(5)
    writeWorkflowE2EEvidence(result)
  })
})
