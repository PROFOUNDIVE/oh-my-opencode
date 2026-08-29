import { describe, expect, test } from "bun:test"

import type { CampaignPhase, CampaignStatus, ResearchCampaignStateV1 } from "../state"
import { getCampaignNextActions } from "./next-actions"
import { awaitingState, campaignState, stateFor } from "./transition-test-fixture"

const PHASES = ["DISCOVERY", "SCREENING", "TOURNAMENT", "DEEP_REFINEMENT", "PROMOTION"] as const
describe("campaign next actions", () => {
  test.each(PHASES)("returns the exact READY actions in %s", (phase: CampaignPhase) => {
    // given
    const state = stateFor(phase, "READY")

    // when
    const actions = getCampaignNextActions(state)

    // then
    expect(actions.map((action) => action.action)).toEqual([
      "step_one_stage",
      "step_to_checkpoint",
      "amend",
      "abort",
    ])
    expect(actions.every((action) => action.required_state_revision === state.state_revision)).toBe(true)
    expect(actions.every((action) => action.reason === "READY_TO_RUN")).toBe(true)
  })

  test.each(PHASES)("limits RUNNING reconciliation in %s", (phase: CampaignPhase) => {
    // given
    const state = stateFor(phase, "RUNNING")

    // when
    const actions = getCampaignNextActions(state)

    // then
    expect(actions.map((action) => action.action)).toEqual(["step_one_stage", "abort"])
    expect(actions.every((action) => action.reason === "RECONCILIATION_REQUIRED")).toBe(true)
  })

  test.each(PHASES)("limits BLOCKED reconciliation in %s", (phase: CampaignPhase) => {
    // given
    const state = stateFor(phase, "BLOCKED")

    // when
    const actions = getCampaignNextActions(state)

    // then
    expect(actions.map((action) => action.action)).toEqual(["step_one_stage", "abort"])
    expect(actions.every((action) => action.reason === "RECONCILIATION_BLOCKED")).toBe(true)
  })

  test("exposes both step modes at the initial-screen checkpoint", () => {
    // given
    const state = awaitingState("SCREENING")

    // when
    const actions = getCampaignNextActions(state)

    // then
    expect(actions.map((action) => action.action)).toEqual([
      "step_one_stage",
      "step_to_checkpoint",
      "amend",
      "abort",
    ])
    expect(actions.every((action) => action.reason === "HUMAN_CHECKPOINT")).toBe(true)
  })

  test.each([
    ["TOURNAMENT", "next_tournament"],
    ["DEEP_REFINEMENT", "selected_refinement"],
  ] as const)(
    "gates %s stepping on an applicable amendment",
    (phase: "TOURNAMENT" | "DEEP_REFINEMENT", scope: "next_tournament" | "selected_refinement") => {
    // given
    const unsatisfied = awaitingState(phase)
    const satisfied = withAmendment(unsatisfied, scope)

    // when
    const before = getCampaignNextActions(unsatisfied)
    const after = getCampaignNextActions(satisfied)

    // then
    expect(before.map((action) => action.action)).toEqual(["amend", "abort"])
    expect(before.every((action) => action.reason === "AMENDMENT_REQUIRED")).toBe(true)
    expect(after.map((action) => action.action)).toEqual([
      "step_one_stage",
      "step_to_checkpoint",
      "amend",
      "abort",
    ])
    },
  )

  test("exposes only promotion and abort before promotion", () => {
    // given
    const state = awaitingState("PROMOTION")

    // when
    const actions = getCampaignNextActions(state)

    // then
    expect(actions.map((action) => action.action)).toEqual(["promote", "abort"])
    expect(actions.every((action) => action.reason === "PROMOTION_DECISION_REQUIRED")).toBe(true)
  })

  test.each(terminalCases())(
    "returns no actions for terminal %s/%s",
    (phase: CampaignPhase, status: Extract<CampaignStatus, "PROMOTION_READY" | "REJECTED" | "ABORTED">) => {
    // given
    const state = stateFor(phase, status)

    // when
    const actions = getCampaignNextActions(state)

    // then
    expect(actions).toEqual([])
    },
  )
})

function withAmendment(state: ResearchCampaignStateV1, scope: "next_tournament" | "selected_refinement") {
  return campaignState({
    ...state,
    amendments: [
      ...state.amendments,
      {
        event_type: "ADDED",
        amendment_id: `amendment-${state.state_revision}`,
        kind: "required_check",
        scope,
        content: "Apply the human intervention.",
        lifecycle: "ACTIVE",
        state_revision: state.state_revision,
      },
    ],
  })
}

function terminalCases(): readonly (readonly [CampaignPhase, Extract<CampaignStatus, "PROMOTION_READY" | "REJECTED" | "ABORTED">])[] {
  const rejectedAndAborted = PHASES.flatMap((phase) => [
    [phase, "REJECTED"],
    [phase, "ABORTED"],
  ] as const)
  return [...rejectedAndAborted, ["PROMOTION", "PROMOTION_READY"]]
}
