import { expect, test } from "bun:test"

import { reduceCampaignTransition } from "../transitions"
import { ScreenIdSchema } from "../state"
import { preparedJob, withValidScreeningSources } from "../transitions/operation-test-fixture"
import { awaitingState, campaignState } from "../transitions/transition-test-fixture"
import { aggregateScreening } from "./screening-aggregation"

test("uses worst-verdict precedence, removes fatal candidates, and applies the stable survivor cap", () => {
  // given
  const screened = withValidScreeningSources(awaitingState("SCREENING"))
  const [first, second] = screened.candidates
  const firstReceipt = screened.screen_receipts[0]
  const secondReceipt = screened.screen_receipts[1]
  if (first === undefined || second === undefined || firstReceipt === undefined || secondReceipt === undefined) throw new Error("fixture")
  const receipts = [
    { ...firstReceipt, verdict: "VIABLE" as const },
    { ...firstReceipt, screen_id: ScreenIdSchema.parse("screen-direct-fatal"), screen_role: "fatal-check", verdict: "FATAL_FLAW" as const },
    { ...secondReceipt, verdict: "REPAIRABLE" as const },
  ]

  // when
  const result = aggregateScreening([first, second], receipts, 1)

  // then
  expect(result.results).toEqual([
    { candidate_id: first.candidate_id, verdict: "FATAL_FLAW" },
    { candidate_id: second.candidate_id, verdict: "REPAIRABLE" },
  ])
  expect(result.survivor_ids).toEqual([second.candidate_id])
})

test("does not admit tournament preparation when every candidate is inconclusive", () => {
  // given
  const screened = withValidScreeningSources(awaitingState("SCREENING"))
  const inconclusive = campaignState({
    ...screened,
    screen_receipts: screened.screen_receipts.map((receipt) => ({
      ...receipt,
      verdict: "INCONCLUSIVE",
    })),
  })
  const tournament = preparedJob(inconclusive, "job-tournament-forbidden", {
    kind: "TOURNAMENT",
    tournament_id: "tournament-forbidden",
  })

  // when
  const result = reduceCampaignTransition(inconclusive, {
    type: "ADMIT_OPERATION",
    job_attempts: [tournament],
    candidates: [],
  })

  // then
  expect(result).toMatchObject({ ok: false, error_code: "VALIDATION_ERROR" })
})

test("does not admit tournament preparation from an incomplete committed screen matrix", () => {
  // given
  const screened = withValidScreeningSources(awaitingState("SCREENING"))
  const incomplete = campaignState({ ...screened, screen_receipts: screened.screen_receipts.slice(0, 1) })
  const tournament = preparedJob(incomplete, "job-tournament-incomplete", {
    kind: "TOURNAMENT",
    tournament_id: "tournament-incomplete",
  })

  // when
  const result = reduceCampaignTransition(incomplete, {
    type: "ADMIT_OPERATION",
    job_attempts: [tournament],
    candidates: [],
  })

  // then
  expect(result).toMatchObject({ ok: false, error_code: "VALIDATION_ERROR" })
})
