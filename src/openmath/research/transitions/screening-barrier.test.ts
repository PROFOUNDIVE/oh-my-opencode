import { expect, test } from "bun:test"

import { reduceCampaignTransition } from "./index"
import {
  completedJob,
  preparedJob,
  screenReceipt,
  withValidScreeningSources,
} from "./operation-test-fixture"
import {
  awaitingState,
  campaignState,
  changed,
  firstCandidate,
} from "./transition-test-fixture"

test("screening cannot pause while an artifact-bearing candidate has no committed screen", () => {
  // given
  const screenedFixture = awaitingState("SCREENING")
  const ready = withValidScreeningSources(campaignState({
    ...screenedFixture,
    status: "READY",
    awaiting_reason: null,
    screen_receipts: [],
  }))
  const direct = firstCandidate(ready)
  const prepared = preparedJob(ready, "job-screen-direct-only", {
    kind: "SCREEN",
    screen_id: "screen-direct-only",
    candidate_id: direct.candidate_id,
  })
  const running = changed(reduceCampaignTransition(ready, {
    type: "ADMIT_OPERATION",
    job_attempts: [prepared],
    candidates: [],
  }))
  const completed = completedJob(prepared, 12, { kind: "SCREEN", screen_id: "screen-direct-only" })

  // when
  const result = reduceCampaignTransition(running, {
    type: "COMPLETE_SCREENING",
    job_attempts: [completed],
    screen_receipts: [screenReceipt(completed, 12)],
  })

  // then
  expect(result).toMatchObject({ ok: false, error_code: "VALIDATION_ERROR" })
})
