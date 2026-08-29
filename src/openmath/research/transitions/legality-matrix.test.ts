import { describe, expect, test } from "bun:test"

import type { ResearchCampaignStateV1 } from "../state"
import { reduceCampaignTransition, type CampaignTransitionEvent } from "./index"
import {
  awaitingState,
  campaignState,
  decisionReceipt,
  dossierReference,
  firstCandidate,
  stateFor,
} from "./transition-test-fixture"

type MatrixEvent =
  | "STEP_ONE"
  | "STEP_CHECKPOINT"
  | Exclude<CampaignTransitionEvent["type"], "REQUEST_STEP">

type MatrixRow = {
  readonly family: string
  readonly state: ResearchCampaignStateV1
  readonly allowed: readonly MatrixEvent[]
}

const READY = ["STEP_ONE", "STEP_CHECKPOINT", "ADMIT_OPERATION", "ADD_AMENDMENT", "RETRACT_AMENDMENT", "ABORT"] as const
const RUNNING_COMMON = ["STEP_ONE", "ABORT", "BLOCK", "REJECT"] as const
const INITIAL_PAUSE = ["STEP_ONE", "STEP_CHECKPOINT", "ADMIT_OPERATION", "ADD_AMENDMENT", "RETRACT_AMENDMENT", "ABORT"] as const
const AMENDMENT_PAUSE = ["ADD_AMENDMENT", "RETRACT_AMENDMENT", "ABORT"] as const
const SATISFIED_PAUSE = ["STEP_ONE", "STEP_CHECKPOINT", "ADMIT_OPERATION", ...AMENDMENT_PAUSE] as const
const BLOCKED = ["STEP_ONE", "ABORT"] as const

const ROWS = [
  ...routineRows("DISCOVERY", "COMPLETE_DISCOVERY"),
  ...routineRows("SCREENING", "COMPLETE_SCREENING"),
  ...routineRows("TOURNAMENT", "COMPLETE_TOURNAMENT"),
  ...routineRows("DEEP_REFINEMENT", "COMPLETE_CHILD_WORKFLOW"),
  ...routineRows("PROMOTION", null),
  { family: "SCREENING/AWAITING_HUMAN", state: awaitingState("SCREENING"), allowed: INITIAL_PAUSE },
  { family: "TOURNAMENT/AWAITING_HUMAN", state: awaitingState("TOURNAMENT"), allowed: AMENDMENT_PAUSE },
  {
    family: "TOURNAMENT/AWAITING_HUMAN/amended",
    state: withApplicableAmendment(awaitingState("TOURNAMENT"), "next_tournament"),
    allowed: SATISFIED_PAUSE,
  },
  { family: "DEEP_REFINEMENT/AWAITING_HUMAN", state: awaitingState("DEEP_REFINEMENT"), allowed: AMENDMENT_PAUSE },
  {
    family: "DEEP_REFINEMENT/AWAITING_HUMAN/amended",
    state: withApplicableAmendment(awaitingState("DEEP_REFINEMENT"), "selected_refinement"),
    allowed: SATISFIED_PAUSE,
  },
  { family: "PROMOTION/AWAITING_HUMAN", state: awaitingState("PROMOTION"), allowed: ["PROMOTE", "ABORT"] },
  { family: "PROMOTION/PROMOTION_READY", state: stateFor("PROMOTION", "PROMOTION_READY"), allowed: [] },
] satisfies readonly MatrixRow[]

const EVENTS = [
  "STEP_ONE",
  "STEP_CHECKPOINT",
  "ADMIT_OPERATION",
  "COMPLETE_DISCOVERY",
  "COMPLETE_SCREENING",
  "COMPLETE_TOURNAMENT",
  "COMPLETE_CHILD_WORKFLOW",
  "DOSSIER_READY",
  "ADD_AMENDMENT",
  "RETRACT_AMENDMENT",
  "PROMOTE",
  "ABORT",
  "BLOCK",
  "REJECT",
] as const satisfies readonly MatrixEvent[]

describe("campaign transition legality matrix", () => {
  test.each(ROWS)("matches every event for $family", ({ state, allowed }) => {
    // given
    const expected = new Set<MatrixEvent>(allowed)

    // when
    const results = EVENTS.map((eventName) => ({
      eventName,
      result: reduceCampaignTransition(state, eventFor(state, eventName)),
    }))

    // then
    for (const { eventName, result } of results) {
      const staticallyLegal = result.ok || result.error_code !== "ILLEGAL_TRANSITION"
      expect(staticallyLegal).toBe(expected.has(eventName))
      if (!staticallyLegal) {
        expect(result.state).toBe(state)
        expect(result.state.state_revision).toBe(state.state_revision)
      }
    }
  })
})

function routineRows(
  phase: Parameters<typeof stateFor>[0],
  completion: Extract<MatrixEvent, `COMPLETE_${string}`> | null,
): readonly MatrixRow[] {
  const running = completion === null ? RUNNING_COMMON : [...RUNNING_COMMON, completion]
  const ready = phase === "PROMOTION"
    ? ["STEP_ONE", "STEP_CHECKPOINT", "DOSSIER_READY", "ADD_AMENDMENT", "RETRACT_AMENDMENT", "ABORT"] as const
    : READY
  return [
    { family: `${phase}/READY`, state: stateFor(phase, "READY"), allowed: ready },
    { family: `${phase}/RUNNING`, state: stateFor(phase, "RUNNING"), allowed: running },
    { family: `${phase}/BLOCKED`, state: stateFor(phase, "BLOCKED"), allowed: BLOCKED },
    { family: `${phase}/REJECTED`, state: stateFor(phase, "REJECTED"), allowed: [] },
    { family: `${phase}/ABORTED`, state: stateFor(phase, "ABORTED"), allowed: [] },
  ]
}

function eventFor(state: ResearchCampaignStateV1, eventName: MatrixEvent): CampaignTransitionEvent {
  switch (eventName) {
    case "STEP_ONE":
      return { type: "REQUEST_STEP", mode: "one_stage" }
    case "STEP_CHECKPOINT":
      return { type: "REQUEST_STEP", mode: "to_checkpoint" }
    case "ADMIT_OPERATION":
      return { type: "ADMIT_OPERATION", job_attempts: [], candidates: [] }
    case "COMPLETE_DISCOVERY":
      return { type: eventName, job_attempts: [], candidates: [] }
    case "COMPLETE_SCREENING":
      return { type: eventName, job_attempts: [], screen_receipts: [] }
    case "COMPLETE_TOURNAMENT":
      return {
        type: eventName,
        job_attempts: [],
        tournament_receipt: awaitingState("TOURNAMENT").tournament_receipts[0] ?? failReceipt(),
        merge_candidate: null,
      }
    case "COMPLETE_CHILD_WORKFLOW":
      return { type: eventName, job_attempts: [], child_result: { status: "PASSED", candidate: firstCandidate(state) } }
    case "DOSSIER_READY":
      return { type: eventName, dossier: dossierReference() }
    case "ADD_AMENDMENT":
      return { type: eventName, kind: "question", scope: "next_tournament", content: "Check it." }
    case "RETRACT_AMENDMENT":
      return { type: eventName, amendment_id: "amendment-1" }
    case "PROMOTE":
      return { type: eventName, decision_receipt: decisionReceipt(state.state_revision + 1, "approve") }
    case "ABORT":
      return { type: eventName, reason: "stopped" }
    case "BLOCK":
      return { type: eventName, reason: "blocked", job_attempts: [] }
    case "REJECT":
      return { type: eventName, job_attempts: [] }
    default:
      return assertNever(eventName)
  }
}

function withApplicableAmendment(
  state: ResearchCampaignStateV1,
  scope: "next_tournament" | "selected_refinement",
): ResearchCampaignStateV1 {
  return campaignState({
    ...state,
    amendments: [{
      event_type: "ADDED",
      amendment_id: `amendment-${state.state_revision}`,
      kind: "required_check",
      scope,
      content: "Apply this intervention.",
      lifecycle: "ACTIVE",
      state_revision: state.state_revision,
    }],
  })
}

function failReceipt(): never {
  throw new TypeError("Tournament fixture requires a receipt")
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected matrix event: ${String(value)}`)
}
