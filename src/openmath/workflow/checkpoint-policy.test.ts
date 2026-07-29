import { describe, expect, test } from "bun:test"

import { WorkflowCheckpointPolicySchema } from "./checkpoint-policy"
import { WorkflowProfileSchema } from "./profile-schema"
import { WorkflowStateV1Schema } from "./state"
import { createWorkflowStateFixture } from "./state/test-fixture"

const ROLES = {
  solve: { agent: "solver", prompt: { kind: "builtin" }, output_adapter: "legacy_json_artifacts" },
  review: { agent: "reviewer", prompt: { kind: "builtin" }, output_adapter: "review_verdict_json" },
  revise: { agent: "solver", prompt: { kind: "builtin" }, output_adapter: "legacy_json_artifacts" },
}

function profile(checkpoint: string) {
  return {
    ...ROLES,
    min_review_rounds: 1,
    max_review_rounds: 3,
    required_consecutive_passes: 1,
    checkpoint,
  }
}

describe("workflow checkpoint policy", () => {
  test("accepts the exact fixed checkpoint literals through persisted state", () => {
    // given
    const state = createWorkflowStateFixture()

    // when
    const policyResults = ["none", "after_solve", "after_review", "every_stage"]
      .map((checkpoint) => WorkflowCheckpointPolicySchema.safeParse(checkpoint).success)
    const profileResult = WorkflowProfileSchema.safeParse(profile("every_stage"))
    const stateResult = WorkflowStateV1Schema.safeParse({
      ...state,
      profile_snapshot: { ...state.profile_snapshot, checkpoint: "every_stage" },
    })

    // then
    expect(policyResults).toEqual([true, true, true, true])
    expect(profileResult.success).toBe(true)
    expect(stateResult.success).toBe(true)
  })

  test("rejects the drifted after_revise literal", () => {
    // given
    const value = "after_revise"

    // when
    const policyResult = WorkflowCheckpointPolicySchema.safeParse(value)
    const profileResult = WorkflowProfileSchema.safeParse(profile(value))

    // then
    expect(policyResult.success).toBe(false)
    expect(profileResult.success).toBe(false)
  })
})
