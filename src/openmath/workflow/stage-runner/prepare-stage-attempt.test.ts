import { createHash } from "node:crypto"
import { expect, test } from "bun:test"

import { renderReferenceBundle } from "../../references/renderer"
import { prepareStageAttempt } from "./prepare-stage-attempt"
import { runningWorkflowState } from "./test-fixture"

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

test("prepares the exact immutable SOLVE idempotency snapshot", () => {
  // given
  const state = runningWorkflowState("SOLVE")
  const profileHash = sha256(JSON.stringify(state.profile_snapshot))
  const referenceHash = renderReferenceBundle(state.reference_snapshot, "solve").sha256
  const inputHash = sha256("")
  const expectedKey = sha256([
    state.run_id,
    state.state_revision,
    "SOLVE",
    state.review_round,
    profileHash,
    referenceHash,
    inputHash,
    1,
  ].join("|"))

  // when
  const prepared = prepareStageAttempt({ state, workflow_input: "prove the theorem" })

  // then
  expect(prepared.attempt).toMatchObject({
    phase: "PREPARED",
    idempotency_key: expectedKey,
    child_title: `[openmath:${expectedKey}] solver run-1 round 1`,
    resolved_model: { providerID: "openai", modelID: "gpt-5.2", variant: "high" },
    profile_hash: profileHash,
    reference_hash: referenceHash,
    artifact_input_hash: inputHash,
    prompt_hash: sha256("solve system"),
  })
  expect(JSON.parse(prepared.input.user_prompt)).toMatchObject({ stage: "SOLVE", workflow_input: "prove the theorem" })
})
