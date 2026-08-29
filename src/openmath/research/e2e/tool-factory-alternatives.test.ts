import { afterEach, describe, expect, test } from "bun:test"

import { createResearchToolFactoryHarness } from "./tool-factory-harness"

const cleanups: (() => void)[] = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

describe("Phase A alternative tool-factory narratives", () => {
  test("creates fresh MERGE_IDEA lineage without copying artifacts and rejects it", async () => {
    // given
    const harness = createResearchToolFactoryHarness({ tournament: "MERGE_IDEA" })
    cleanups.push(harness.cleanup)

    // when
    const result = await harness.runToDecision("reject")

    // then
    expect(result.selected).toMatchObject({ selected_candidate_id: "merged-01" })
    expect(result.decision).toMatchObject({ status: "REJECTED", next_actions: [] })
    expect(result.persisted.merge_candidate).toMatchObject({
      candidate_id: "merged-01",
      parent_candidate_ids: ["direct-01", "contradiction-01"],
    })
    expect(result.persisted.merge_candidate?.artifact).not.toContain(
      harness.parentArtifactSentinel,
    )
    expect(result.counts).toMatchObject({ refinements: 2, canonical_writes: 0, continuation_tasks: 0 })
    expect(result.counts.forbidden_operations).toEqual({
      canonical_export: 0,
      authority_refinement: 0,
      continuation_schedule: 0,
      artifact_patch: 0,
      artifact_merge: 0,
    })
  })

  test("requires an amendment before resuming NEEDS_HUMAN", async () => {
    // given
    const harness = createResearchToolFactoryHarness({ tournament: "NEEDS_HUMAN_THEN_KEEP" })
    cleanups.push(harness.cleanup)

    // when
    const result = await harness.runNeedsHumanAmendResume()

    // then
    expect(result.paused).toMatchObject({
      status: "AWAITING_HUMAN",
      awaiting_reason: "TOURNAMENT_NEEDS_HUMAN",
    })
    expect(result.step_without_amendment).toMatchObject({
      ok: false,
      error_code: "ILLEGAL_TRANSITION",
    })
    expect(result.amended).toMatchObject({ ok: true })
    expect(result.resumed).toMatchObject({
      ok: true,
      phase: "DEEP_REFINEMENT",
      selected_candidate_id: "direct-01",
    })
    expect(result.tournament_dispatches).toBe(2)
  })
})
