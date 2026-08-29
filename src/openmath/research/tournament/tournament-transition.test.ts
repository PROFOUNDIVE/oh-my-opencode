import { expect, test } from "bun:test"

import { TournamentReceiptSchema, TournamentResultSchema } from "../state"
import { reduceCampaignTransition } from "../transitions"
import {
  completedJob,
  preparedJob,
  tournamentReceipt,
  withValidScreeningSources,
} from "../transitions/operation-test-fixture"
import { awaitingState, changed } from "../transitions/transition-test-fixture"

test("resumes after screening and commits a categorical KEEP", () => {
  // given
  const checkpoint = withValidScreeningSources(awaitingState("SCREENING"))
  const prepared = preparedJob(checkpoint, "job-tournament-retry", {
    kind: "TOURNAMENT",
    tournament_id: "tournament-retry",
  })
  const running = changed(reduceCampaignTransition(checkpoint, {
    type: "ADMIT_OPERATION",
    job_attempts: [prepared],
    candidates: [],
  }))
  const tournamentResult = TournamentResultSchema.parse({
    kind: "DECIDED",
    actions: [{ candidate_id: "direct-01", action: "KEEP" }],
    synthesis_brief: null,
    synthesis_brief_sha256: null,
  })
  const completed = completedJob(prepared, running.state_revision + 1, {
    kind: "TOURNAMENT",
    tournament_id: "tournament-retry",
    result: tournamentResult,
  })
  const receipt = TournamentReceiptSchema.parse({
    ...tournamentReceipt(completed, running.state_revision + 1),
    screen_ids: ["screen-direct-01"],
    result: tournamentResult,
  })

  // when
  const result = reduceCampaignTransition(running, {
    type: "COMPLETE_TOURNAMENT",
    job_attempts: [completed],
    tournament_receipt: receipt,
    merge_candidate: null,
  })

  // then
  expect(result.ok).toBe(true)
  if (result.ok) {
    expect(result.state).toMatchObject({
      phase: "DEEP_REFINEMENT",
      status: "READY",
      selected_candidate_id: "direct-01",
    })
  }
})

test("rejects KEEP for a screened candidate outside the fixed survivor set", () => {
  // given
  const checkpoint = withValidScreeningSources(awaitingState("SCREENING"))
  const prepared = preparedJob(checkpoint, "job-tournament-non-survivor", {
    kind: "TOURNAMENT",
    tournament_id: "tournament-non-survivor",
  })
  const running = changed(reduceCampaignTransition(checkpoint, {
    type: "ADMIT_OPERATION",
    job_attempts: [prepared],
    candidates: [],
  }))
  const tournamentResult = TournamentResultSchema.parse({
    kind: "DECIDED",
    actions: [
      { candidate_id: "direct-01", action: "DROP" },
      { candidate_id: "construction-01", action: "KEEP" },
    ],
    synthesis_brief: null,
    synthesis_brief_sha256: null,
  })
  const completed = completedJob(prepared, running.state_revision + 1, {
    kind: "TOURNAMENT",
    tournament_id: "tournament-non-survivor",
    result: tournamentResult,
  })
  const receipt = TournamentReceiptSchema.parse({
    ...tournamentReceipt(completed, running.state_revision + 1),
    result: tournamentResult,
  })

  // when
  const result = reduceCampaignTransition(running, {
    type: "COMPLETE_TOURNAMENT",
    job_attempts: [completed],
    tournament_receipt: receipt,
    merge_candidate: null,
  })

  // then
  expect(result).toMatchObject({ ok: false, error_code: "VALIDATION_ERROR" })
})
