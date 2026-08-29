import { describe, expect, test } from "bun:test"

import { getCampaignNextActions, shouldContinueCampaignStep } from "./index"
import { awaitingState, stateFor } from "./transition-test-fixture"

describe("campaign step checkpoints", () => {
  test("one_stage never repeats while to_checkpoint repeats only from READY", () => {
    // given
    const ready = stateFor("DISCOVERY", "READY")
    const awaiting = awaitingState("SCREENING")

    // when
    const oneStage = shouldContinueCampaignStep("one_stage", ready)
    const toCheckpoint = shouldContinueCampaignStep("to_checkpoint", ready)
    const atHumanBoundary = shouldContinueCampaignStep("to_checkpoint", awaiting)

    // then
    expect(oneStage).toBe(false)
    expect(toCheckpoint).toBe(true)
    expect(atHumanBoundary).toBe(false)
  })

  test("derived reads do not mutate or advance campaign state", () => {
    // given
    const state = awaitingState("SCREENING")
    const bytes = JSON.stringify(state)

    // when
    getCampaignNextActions(state)
    shouldContinueCampaignStep("to_checkpoint", state)

    // then
    expect(JSON.stringify(state)).toBe(bytes)
    expect(state.state_revision).toBe(10)
    expect("step_mode" in state).toBe(false)
    expect("next_actions" in state).toBe(false)
  })

  test.each([
    ["SCREENING", "AFTER_INITIAL_SCREEN"],
    ["TOURNAMENT", "TOURNAMENT_NEEDS_HUMAN"],
    ["DEEP_REFINEMENT", "CHILD_WORKFLOW_INTERVENTION"],
    ["PROMOTION", "BEFORE_PROMOTION"],
  ] as const)("to_checkpoint stops at %s/%s", (phase: "SCREENING" | "TOURNAMENT" | "DEEP_REFINEMENT" | "PROMOTION") => {
    // given
    const state = awaitingState(phase)

    // when
    const shouldContinue = shouldContinueCampaignStep("to_checkpoint", state)

    // then
    expect(shouldContinue).toBe(false)
  })
})
