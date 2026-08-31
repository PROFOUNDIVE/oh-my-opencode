import { afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"

import { getResearchCampaignDirectory } from "../storage"
import { createResearchToolFactoryHarness } from "./tool-factory-harness"

const cleanups: (() => void)[] = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

describe("Phase A research tool factories", () => {
  test("drives isolated KEEP discovery through explicit approval", async () => {
    // given
    const harness = createResearchToolFactoryHarness({ tournament: "KEEP" })
    cleanups.push(harness.cleanup)

    // when
    const result = await harness.runToDecision("approve")

    // then
    expect(result.checkpoint).toMatchObject({
      ok: true,
      phase: "SCREENING",
      status: "AWAITING_HUMAN",
      awaiting_reason: "AFTER_INITIAL_SCREEN",
      candidate_details: expect.any(Array),
    })
    expect(result.selected).toMatchObject({
      ok: true,
      phase: "DEEP_REFINEMENT",
      status: "READY",
      selected_candidate_id: "direct-01",
    })
    expect(result.ready).toMatchObject({
      ok: true,
      phase: "PROMOTION",
      status: "AWAITING_HUMAN",
      awaiting_reason: "BEFORE_PROMOTION",
      dossier: {
        canonical: false,
        mathematical_correctness_certified: false,
        human_approval_required: true,
      },
    })
    expect(result.decision).toMatchObject({
      ok: true,
      status: "PROMOTION_READY",
      next_actions: [],
    })
    expect(result.counts).toEqual({
      candidates: 2,
      screens: 2,
      tournaments: 1,
      refinements: 1,
      canonical_writes: 0,
      continuation_tasks: 0,
      forbidden_operations: {
        canonical_export: 0,
        authority_refinement: 0,
        continuation_schedule: 0,
        artifact_patch: 0,
        artifact_merge: 0,
      },
    })
    expect(result.isolation.candidate_b_contains_a_sentinel).toBe(false)
    expect(result.isolation.tournament_before_all_screens).toBe(false)
    expect(result.persisted.dossier_bytes_unchanged).toBe(true)
    expect(result.persisted.revisions).toEqual(
      Array.from({ length: result.persisted.revisions.length }, (_, index) => index),
    )
    expect(existsSync(join(getResearchCampaignDirectory(harness.directory, "campaign-a"), "certification"))).toBe(false)
  })
})
