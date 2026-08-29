import { describe, expect, test } from "bun:test"

import { CandidateDescriptorSchema, TournamentReceiptSchema, TournamentResultSchema } from "../state"
import { sha256 } from "../../workflow/stage-runner/sha256"
import { reduceCampaignTransition } from "./index"
import {
  HASH_A,
  completedJob,
  preparedJob,
  tournamentReceipt,
  withValidScreeningSources,
} from "./operation-test-fixture"
import {
  awaitingState,
  changed,
  decisionReceipt,
  firstCandidate,
  selectedCandidateId,
  stateFor,
} from "./transition-test-fixture"

describe("campaign categorical outcomes", () => {
  test("a passed selected child advances to promotion readiness for dossier construction", () => {
    // given
    const ready = stateFor("DEEP_REFINEMENT", "READY")
    const candidate = firstCandidate(ready)
    const prepared = preparedJob(ready, "job-refinement-passed", {
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
      candidate_id: candidate.candidate_id,
      artifact_sha256: candidate.artifact?.sha256 ?? HASH_A,
    })

    // when
    const result = reduceCampaignTransition(running, {
      type: "COMPLETE_CHILD_WORKFLOW",
      job_attempts: [completed],
      child_result: { status: "PASSED", candidate },
    })

    // then
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.state).toMatchObject({ phase: "PROMOTION", status: "READY", dossier: null })
  })

  test("NEEDS_HUMAN pauses and consumes the amendment that authorized retry", () => {
    // given
    const amended = changed(reduceCampaignTransition(withValidScreeningSources(awaitingState("TOURNAMENT")), {
      type: "ADD_AMENDMENT",
      kind: "required_check",
      scope: "next_tournament",
      content: "Retry with the edge case.",
    }))
    const prepared = preparedJob(amended, "job-tournament-amended", {
      kind: "TOURNAMENT",
      tournament_id: "tournament-amended",
    })
    const running = changed(reduceCampaignTransition(amended, {
      type: "ADMIT_OPERATION",
      job_attempts: [prepared],
      candidates: [],
    }))
    const tournamentResult = TournamentResultSchema.parse({ kind: "NEEDS_HUMAN" })
    const completed = completedJob(prepared, 13, {
      kind: "TOURNAMENT",
      tournament_id: "tournament-amended",
      result: tournamentResult,
    })
    const receipt = TournamentReceiptSchema.parse({
      ...tournamentReceipt(completed, 13),
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
      expect(result.state).toMatchObject({ status: "AWAITING_HUMAN", awaiting_reason: "TOURNAMENT_NEEDS_HUMAN" })
      expect(result.state.amendments[result.state.amendments.length - 1]).toMatchObject({
        event_type: "CONSUMED",
        state_revision: 13,
      })
    }
  })

  test("MERGE_IDEA appends exactly the lineage-only selected candidate", () => {
    // given
    const paused = withValidScreeningSources(awaitingState("SCREENING"), 2)
    const prepared = preparedJob(paused, "job-tournament-merge", {
      kind: "TOURNAMENT",
      tournament_id: "tournament-merge",
    })
    const running = changed(reduceCampaignTransition(paused, {
      type: "ADMIT_OPERATION",
      job_attempts: [prepared],
      candidates: [],
    }))
    const synthesisBrief = "Combine the direct and constructive ideas."
    const synthesisBriefSha256 = sha256(synthesisBrief)
    const tournamentResult = TournamentResultSchema.parse({
      kind: "DECIDED",
      actions: [
        { candidate_id: "direct-01", action: "MERGE_IDEA" },
        { candidate_id: "construction-01", action: "MERGE_IDEA" },
      ],
      synthesis_brief: synthesisBrief,
      synthesis_brief_sha256: synthesisBriefSha256,
    })
    const completed = completedJob(prepared, 12, {
      kind: "TOURNAMENT",
      tournament_id: "tournament-merge",
      result: tournamentResult,
    })
    const receipt = TournamentReceiptSchema.parse({
      ...tournamentReceipt(completed, 12),
      result: tournamentResult,
    })
    const merge = CandidateDescriptorSchema.parse({
      candidate_kind: "MERGE_IDEA",
      candidate_id: "merged-01",
      created_at_revision: 12,
      child_run_id: "campaign-1::merged-01",
      child_state_revision: null,
      artifact: null,
      parent_candidate_ids: ["direct-01", "construction-01"],
      synthesis_brief: synthesisBrief,
      synthesis_brief_sha256: synthesisBriefSha256,
      attachments: [],
    })

    // when
    const result = reduceCampaignTransition(running, {
      type: "COMPLETE_TOURNAMENT",
      job_attempts: [completed],
      tournament_receipt: receipt,
      merge_candidate: merge,
    })

    // then
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.state.selected_candidate_id).toBe("merged-01")
      expect(result.state.candidates[result.state.candidates.length - 1]).toEqual(merge)
    }
  })

  test("an explicit reject decision reaches only terminal REJECTED", () => {
    // given
    const awaiting = awaitingState("PROMOTION")

    // when
    const result = reduceCampaignTransition(awaiting, {
      type: "PROMOTE",
      decision_receipt: decisionReceipt(11, "reject"),
    })

    // then
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.state.status).toBe("REJECTED")
  })

  test("dossier readiness rejects PROMOTION state without a committed refinement completion", () => {
    // given
    const unproven = stateFor("PROMOTION", "READY")

    // when
    const result = reduceCampaignTransition(unproven, {
      type: "DOSSIER_READY",
      dossier: awaitingState("PROMOTION").dossier ?? failDossier(),
    })

    // then
    expect(result).toMatchObject({ ok: false, error_code: "VALIDATION_ERROR" })
  })
})

function failDossier(): never {
  throw new TypeError("Promotion fixture requires a dossier")
}
