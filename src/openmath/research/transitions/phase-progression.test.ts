import { describe, expect, test } from "bun:test"

import { ResearchCampaignStateV1Schema } from "../state"
import { reduceCampaignTransition } from "./index"
import {
  HASH_A,
  completedJob,
  preparedJob,
  screenReceipt,
  withValidScreeningSources,
} from "./operation-test-fixture"
import {
  changed,
  decisionReceipt,
  dossierReference,
  emptyDiscoveryState,
  firstCandidate,
  selectedCandidateId,
  stateFor,
  strategyCandidate,
} from "./transition-test-fixture"

describe("campaign phase progression", () => {
  test("admits and completes discovery into screening readiness", () => {
    // given
    const initial = emptyDiscoveryState()
    const plannedCandidate = strategyCandidate(false)
    const prepared = preparedJob(initial, "job-discovery-direct-01", {
      kind: "CANDIDATE",
      candidate_id: plannedCandidate.candidate_id,
    })
    const running = changed(reduceCampaignTransition(initial, {
      type: "ADMIT_OPERATION",
      job_attempts: [prepared],
      candidates: [plannedCandidate],
    }))
    const completedCandidate = strategyCandidate(true)
    const completed = completedJob(prepared, 2, {
      kind: "CANDIDATE_ARTIFACT",
      candidate_id: completedCandidate.candidate_id,
      artifact_sha256: HASH_A,
    })

    // when
    const result = reduceCampaignTransition(running, {
      type: "COMPLETE_DISCOVERY",
      job_attempts: [completed],
      candidates: [completedCandidate],
    })

    // then
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.state).toMatchObject({ phase: "SCREENING", status: "READY", state_revision: 2 })
      expect(result.state.candidates[0]?.artifact?.sha256).toBe(HASH_A)
      expect(ResearchCampaignStateV1Schema.safeParse(result.state).success).toBe(true)
    }
  })

  test("opens the initial-screen checkpoint only after every admitted screen commits", () => {
    // given
    const ready = withValidScreeningSources(stateFor("SCREENING", "READY"))
    const prepared = preparedJob(ready, "job-screen-direct-02", {
      kind: "SCREEN",
      screen_id: "screen-direct-02",
      candidate_id: firstCandidate(ready).candidate_id,
    })
    const running = changed(reduceCampaignTransition(ready, {
      type: "ADMIT_OPERATION",
      job_attempts: [prepared],
      candidates: [],
    }))
    const completed = completedJob(prepared, 12, { kind: "SCREEN", screen_id: "screen-direct-02" })
    const receipt = screenReceipt(completed, 12)

    // when
    const missing = reduceCampaignTransition(running, {
      type: "COMPLETE_SCREENING",
      job_attempts: [completed],
      screen_receipts: [],
    })
    const complete = reduceCampaignTransition(running, {
      type: "COMPLETE_SCREENING",
      job_attempts: [completed],
      screen_receipts: [receipt],
    })

    // then
    expect(missing).toMatchObject({ ok: false, error_code: "VALIDATION_ERROR" })
    expect(complete.ok).toBe(true)
    if (complete.ok) {
      expect(complete.state).toMatchObject({
        phase: "SCREENING",
        status: "AWAITING_HUMAN",
        awaiting_reason: "AFTER_INITIAL_SCREEN",
      })
    }
  })

  test("maps child intervention, block, and terminal failure without workflow stages", () => {
    // given
    const selected = firstCandidate(stateFor("DEEP_REFINEMENT", "READY"))
    const outcomes = [
      [{ status: "AWAITING_HUMAN", candidate: selected }, "AWAITING_HUMAN"],
      [{ status: "BLOCKED", reason: "child reconciliation blocked" }, "BLOCKED"],
      [{ status: "EXHAUSTED" }, "REJECTED"],
      [{ status: "ABORTED" }, "REJECTED"],
    ] as const

    // when
    const results = outcomes.map(([child_result, expectedStatus], index) => {
      const ready = stateFor("DEEP_REFINEMENT", "READY")
      const prepared = preparedJob(ready, `job-refinement-${index + 1}`, {
        kind: "CANDIDATE",
        candidate_id: selectedCandidateId(ready),
      })
      const running = changed(reduceCampaignTransition(ready, {
        type: "ADMIT_OPERATION",
        job_attempts: [prepared],
        candidates: [],
      }))
      const completed = completedJob(prepared, 12, {
        kind: "CANDIDATE_ARTIFACT",
        candidate_id: selectedCandidateId(ready),
        artifact_sha256: HASH_A,
      })
      return [reduceCampaignTransition(running, {
        type: "COMPLETE_CHILD_WORKFLOW",
        job_attempts: [completed],
        child_result,
      }), expectedStatus] as const
    })

    // then
    for (const [result, expectedStatus] of results) {
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.state.status).toBe(expectedStatus)
    }
  })

  test("requires dossier readiness before an explicit matching promotion decision", () => {
    // given
    const refinementReady = stateFor("DEEP_REFINEMENT", "READY")
    const selected = firstCandidate(refinementReady)
    const prepared = preparedJob(refinementReady, "job-refinement-passed", {
      kind: "CANDIDATE",
      candidate_id: selected.candidate_id,
    })
    const running = changed(reduceCampaignTransition(refinementReady, {
      type: "ADMIT_OPERATION",
      job_attempts: [prepared],
      candidates: [],
    }))
    const completed = completedJob(prepared, 12, {
      kind: "CANDIDATE_ARTIFACT",
      candidate_id: selected.candidate_id,
      artifact_sha256: HASH_A,
    })
    const ready = changed(reduceCampaignTransition(running, {
      type: "COMPLETE_CHILD_WORKFLOW",
      job_attempts: [completed],
      child_result: { status: "PASSED", candidate: selected },
    }))
    const premature = reduceCampaignTransition(ready, {
      type: "PROMOTE",
      decision_receipt: decisionReceipt(13, "approve"),
    })
    const awaiting = changed(reduceCampaignTransition(ready, {
      type: "DOSSIER_READY",
      dossier: dossierReference(ready.state_revision + 1),
    }))

    // when
    const approved = reduceCampaignTransition(awaiting, {
      type: "PROMOTE",
      decision_receipt: decisionReceipt(14, "approve"),
    })

    // then
    expect(premature).toMatchObject({ ok: false, error_code: "ILLEGAL_TRANSITION" })
    expect(awaiting).toMatchObject({
      phase: "PROMOTION",
      status: "AWAITING_HUMAN",
      awaiting_reason: "BEFORE_PROMOTION",
    })
    expect(approved.ok).toBe(true)
    if (approved.ok) expect(approved.state.status).toBe("PROMOTION_READY")
  })
})
