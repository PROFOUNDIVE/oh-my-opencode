import { describe, expect, test } from "bun:test"

import { WorkflowStateV1Schema } from "./state"
import { createWorkflowStateFixture } from "./state/test-fixture"

describe("persisted workflow snapshots", () => {
  test("retains Task 5 model, prompt, and stop-policy constraints", () => {
    // given
    const fixture = createWorkflowStateFixture()
    const invalidProfiles = [
      { ...fixture.profile_snapshot, solve: { ...fixture.profile_snapshot.solve, model: { providerID: " ", modelID: "gpt-5" } } },
      { ...fixture.profile_snapshot, solve: { ...fixture.profile_snapshot.solve, model: { providerID: "open ai", modelID: "gpt-5" } } },
      { ...fixture.profile_snapshot, solve: { ...fixture.profile_snapshot.solve, prompt: { kind: "inline", content: " " } } },
      { ...fixture.profile_snapshot, min_review_rounds: 4, max_review_rounds: 3 },
      { ...fixture.profile_snapshot, required_consecutive_passes: 4, max_review_rounds: 3 },
    ]

    // when
    const results = invalidProfiles.map((profile_snapshot) => WorkflowStateV1Schema.safeParse({
      ...fixture,
      stage_history: [],
      dispatch_attempts: [],
      profile_snapshot,
    }))

    // then
    expect(results.every((result) => !result.success)).toBe(true)
  })

  test("retains Task 6 unique reference IDs and stage subsets", () => {
    // given
    const fixture = createWorkflowStateFixture()
    const reference = {
      id: "reference-1",
      role: "authoritative",
      stages: ["solve"],
      required: true,
      content: "reference",
      sha256: "c".repeat(64),
      source: { kind: "inline", path: "inline:reference-1" },
    }
    const snapshots = [
      { ...fixture.reference_snapshot, references: [reference, { ...reference }] },
      { ...fixture.reference_snapshot, references: [{ ...reference, stages: ["solve", "solve"] }] },
      { ...fixture.reference_snapshot, references: [{ ...reference, id: " " }] },
    ]

    // when
    const results = snapshots.map((reference_snapshot) => WorkflowStateV1Schema.safeParse({
      ...fixture,
      stage_history: [],
      dispatch_attempts: [],
      reference_snapshot,
    }))

    // then
    expect(results.every((result) => !result.success)).toBe(true)
  })
})
