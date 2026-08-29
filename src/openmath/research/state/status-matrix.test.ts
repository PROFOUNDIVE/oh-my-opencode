import { describe, expect, test } from "bun:test"

import { ResearchCampaignStateV1Schema, type CampaignPhase, type CampaignStatus } from "./index"
import { campaignWithReceipts } from "./aggregate-test-fixture"
import { createResearchCampaignStateFixture } from "./test-fixture"
import { decision, dossier } from "./promotion-test-fixture"

const PHASES = ["DISCOVERY", "SCREENING", "TOURNAMENT", "DEEP_REFINEMENT", "PROMOTION"] as const
const AWAITING_PHASES = [
  ["SCREENING", "AFTER_INITIAL_SCREEN"],
  ["TOURNAMENT", "TOURNAMENT_NEEDS_HUMAN"],
  ["DEEP_REFINEMENT", "CHILD_WORKFLOW_INTERVENTION"],
  ["PROMOTION", "BEFORE_PROMOTION"],
] as const

describe("ResearchCampaignStateV1 status matrix", () => {
  test("accepts every legal phase and status combination", () => {
    // given
    const routineStatuses = ["READY", "RUNNING", "BLOCKED", "REJECTED", "ABORTED"] as const
    const routineStates = PHASES.flatMap((phase) => routineStatuses.map((status) => (
      phase === "PROMOTION" && status === "REJECTED"
        ? { ...stateFor(phase, status), dossier: dossier(), decision_receipt: decision("reject") }
        : stateFor(phase, status)
    )))
    const awaitingStates = AWAITING_PHASES.map(([phase, awaitingReason]) => ({
      ...stateFor(phase, "AWAITING_HUMAN"),
      awaiting_reason: awaitingReason,
      ...(phase === "PROMOTION" ? { dossier: dossier(10) } : {}),
    }))
    const promotionReady = {
      ...stateFor("PROMOTION", "PROMOTION_READY"),
      dossier: dossier(),
      decision_receipt: decision("approve"),
    }
    const states = [...routineStates, ...awaitingStates, promotionReady]

    // when
    const results = states.map((state) => ResearchCampaignStateV1Schema.safeParse(state))

    // then
    expect(states).toHaveLength(30)
    expect(results.every((result) => result.success)).toBe(true)
  })

  test("rejects illegal phase, status, reason, continuation, dossier, and decision nullability", () => {
    // given
    const invalid = [
      { ...stateFor("DISCOVERY", "AWAITING_HUMAN"), awaiting_reason: "AFTER_INITIAL_SCREEN" },
      { ...stateFor("SCREENING", "AWAITING_HUMAN"), awaiting_reason: "BEFORE_PROMOTION" },
      { ...stateFor("DISCOVERY", "PROMOTION_READY"), dossier: dossier(), decision_receipt: decision("approve") },
      { ...stateFor("PROMOTION", "PROMOTION_READY"), dossier: null, decision_receipt: decision("approve") },
      { ...stateFor("PROMOTION", "PROMOTION_READY"), dossier: dossier(), decision_receipt: decision("reject") },
      { ...stateFor("PROMOTION", "REJECTED"), dossier: null, decision_receipt: null },
      { ...stateFor("PROMOTION", "REJECTED"), dossier: dossier(), decision_receipt: { ...decision("reject"), dossier_sha256: "b".repeat(64) } },
      { ...stateFor("PROMOTION", "AWAITING_HUMAN"), awaiting_reason: "BEFORE_PROMOTION", dossier: null },
      { ...stateFor("SCREENING", "READY"), dossier: dossier() },
      { ...stateFor("SCREENING", "READY"), selected_candidate_id: "direct-01" },
      { ...stateFor("DEEP_REFINEMENT", "READY"), selected_candidate_id: null },
      { ...stateFor("DISCOVERY", "READY"), abort_requested: true },
      { ...stateFor("DISCOVERY", "REJECTED"), active_job_ids: ["job-discovery-direct-01"] },
      { ...stateFor("DISCOVERY", "READY"), next_actions: [] },
    ]

    // when
    const results = invalid.map((state) => ResearchCampaignStateV1Schema.safeParse(state))

    // then
    expect(results.every((result) => !result.success)).toBe(true)
  })
})

function stateFor(phase: CampaignPhase, status: CampaignStatus) {
  const base = phase === "DEEP_REFINEMENT" || phase === "PROMOTION"
    ? campaignWithReceipts()
    : createResearchCampaignStateFixture()
  const selected = phase === "DEEP_REFINEMENT" || phase === "PROMOTION" ? "direct-01" : null
  const statusFields = fieldsForStatus(status)
  return { ...base, phase, status, selected_candidate_id: selected, ...statusFields }
}

function fieldsForStatus(status: CampaignStatus) {
  switch (status) {
    case "RUNNING":
      return { awaiting_reason: null, abort_requested: false, abort_reason: null, blocked_reason: null, active_job_ids: ["job-discovery-direct-01"] }
    case "BLOCKED":
      return { awaiting_reason: null, abort_requested: false, abort_reason: null, blocked_reason: "reconciliation ambiguous", active_job_ids: [] }
    case "ABORTED":
      return { awaiting_reason: null, abort_requested: true, abort_reason: "stopped", blocked_reason: null, active_job_ids: [] }
    case "AWAITING_HUMAN":
    case "PROMOTION_READY":
    case "REJECTED":
    case "READY":
      return { awaiting_reason: null, abort_requested: false, abort_reason: null, blocked_reason: null, active_job_ids: [] }
    default:
      return assertNever(status)
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected test status: ${String(value)}`)
}
