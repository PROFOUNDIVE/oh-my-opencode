import { describe, expect, test } from "bun:test"

import { amendResearchCampaign } from "../application"
import { awaitingState } from "../transitions/transition-test-fixture"

describe("selected refinement amendment ordering", () => {
  test("does not mutate the child when campaign CAS fails", async () => {
    // given
    const state = awaitingState("DEEP_REFINEMENT")
    let childMutations = 0

    // when
    const result = await amendResearchCampaign({
      directory: "/tmp/task-15-amendment-ordering",
      campaign_id: state.campaign_id,
      expected_state_revision: state.state_revision,
      operation: "add",
      kind: "required_check",
      scope: "selected_refinement",
      content: "Do not orphan this amendment.",
    }, {
      read_state: async () => ({ kind: "ok", state }),
      compare_and_swap: async () => ({ kind: "error", error_code: "STORAGE_WRITE_FAILED", message: "injected failure" }),
      amend_workflow: async () => {
        childMutations += 1
        return { kind: "ok" }
      },
    })

    // then
    expect(result).toMatchObject({ ok: false, error_code: "STORAGE_WRITE_FAILED" })
    expect(childMutations).toBe(0)
  })
})
