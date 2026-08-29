import { describe, expect, test } from "bun:test"

import { sha256 } from "../../workflow/stage-runner/sha256"
import { CampaignHashSchema, CandidateDescriptorSchema, ResearchCampaignStateV1Schema } from "../state"
import { awaitingState } from "../transitions/transition-test-fixture"
import { withValidScreeningSources } from "../transitions/operation-test-fixture"
import { admitTournamentCandidates } from "./tournament-admission"

const HASH_B = CampaignHashSchema.parse("b".repeat(64))

describe("tournament admission", () => {
  test("admits the fixed survivor set only from the explicit initial-screen checkpoint", () => {
    // given
    const checkpoint = withValidScreeningSources(awaitingState("SCREENING"))

    // when
    const admitted = admitTournamentCandidates(checkpoint)
    const premature = admitTournamentCandidates(ResearchCampaignStateV1Schema.parse({
      ...checkpoint,
      status: "READY",
      awaiting_reason: null,
    }))

    // then
    expect(admitted.ok).toBe(true)
    if (admitted.ok) expect(admitted.candidates.map(({ candidate }) => candidate.candidate_id)).toEqual(["direct-01"])
    expect(premature).toMatchObject({ ok: false })
  })

  test("fails closed when a committed screen artifact hash is stale", () => {
    // given
    const checkpoint = withValidScreeningSources(awaitingState("SCREENING"))
    const stale = {
      ...checkpoint,
      screen_receipts: checkpoint.screen_receipts.map((receipt, index) => index === 0
        ? { ...receipt, artifact: { ...receipt.artifact, sha256: HASH_B } }
        : receipt),
    }

    // when
    const result = admitTournamentCandidates(stale)

    // then
    expect(result).toMatchObject({ ok: false })
  })

  test("rejects recursive or second-merge tournament admission", () => {
    // given
    const awaiting = withValidScreeningSources(awaitingState("TOURNAMENT"))
    const synthesisBrief = "Already merged."
    const merge = CandidateDescriptorSchema.parse({
      candidate_kind: "MERGE_IDEA",
      candidate_id: "merged-01",
      created_at_revision: awaiting.state_revision,
      child_run_id: "campaign-1::merged-01",
      child_state_revision: null,
      artifact: null,
      parent_candidate_ids: ["direct-01", "construction-01"],
      synthesis_brief: synthesisBrief,
      synthesis_brief_sha256: sha256(synthesisBrief),
      attachments: [],
    })
    const recursive = ResearchCampaignStateV1Schema.parse({
      ...awaiting,
      candidates: [...awaiting.candidates, merge],
    })

    // when
    const result = admitTournamentCandidates(recursive)

    // then
    expect(result).toMatchObject({ ok: false })
  })
})
