import { expect, test } from "bun:test"

import { reduceCampaignTransition } from "../transitions"
import { completedJob, preparedJob, screenReceipt, withValidScreeningSources } from "../transitions/operation-test-fixture"
import { changed, firstCandidate, stateFor } from "../transitions/transition-test-fixture"

test("rejects screening completion without persisted normalized terminal evidence", () => {
  // given
  const ready = withValidScreeningSources(stateFor("SCREENING", "READY"))
  const candidate = firstCandidate(ready)
  const prepared = preparedJob(ready, "job-screen-direct-terminal", {
    kind: "SCREEN",
    screen_id: "screen-direct-terminal",
    candidate_id: candidate.candidate_id,
  })
  const running = changed(reduceCampaignTransition(ready, {
    type: "ADMIT_OPERATION",
    job_attempts: [prepared],
    candidates: [],
  }))
  const withEvidence = completedJob(prepared, running.state_revision + 1, {
    kind: "SCREEN",
    screen_id: "screen-direct-terminal",
  })
  if (withEvidence.phase !== "COMPLETED" || withEvidence.receipt.kind !== "SCREEN") throw new Error("fixture")
  const { normalized_output: _normalizedOutput, ...receiptWithoutEvidence } = withEvidence.receipt
  const completed = { ...withEvidence, receipt: receiptWithoutEvidence }

  // when
  const result = reduceCampaignTransition(running, {
    type: "COMPLETE_SCREENING",
    job_attempts: [completed],
    screen_receipts: [screenReceipt(completed, running.state_revision + 1)],
  })

  // then
  expect(result).toMatchObject({ ok: false, error_code: "VALIDATION_ERROR" })
})

test("rejects screening completion when frozen profile evidence is invalid", () => {
  // given
  const ready = stateFor("SCREENING", "READY")
  const candidate = firstCandidate(ready)
  const prepared = preparedJob(ready, "job-screen-invalid-profile", {
    kind: "SCREEN",
    screen_id: "screen-invalid-profile",
    candidate_id: candidate.candidate_id,
  })
  const running = changed(reduceCampaignTransition(ready, {
    type: "ADMIT_OPERATION",
    job_attempts: [prepared],
    candidates: [],
  }))
  const completed = completedJob(prepared, running.state_revision + 1, {
    kind: "SCREEN",
    screen_id: "screen-invalid-profile",
  })

  // when
  const result = reduceCampaignTransition(running, {
    type: "COMPLETE_SCREENING",
    job_attempts: [completed],
    screen_receipts: [screenReceipt(completed, running.state_revision + 1)],
  })

  // then
  expect(result).toMatchObject({ ok: false, error_code: "VALIDATION_ERROR" })
  if (!result.ok) expect(result.message).toContain("Frozen candidate source hash")
})
