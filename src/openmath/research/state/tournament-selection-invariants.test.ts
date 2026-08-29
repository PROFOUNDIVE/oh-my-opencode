import { describe, expect, test } from "bun:test"

import { sha256 } from "../../workflow/stage-runner/sha256"
import { ResearchCampaignStateV1Schema } from "./index"
import { campaignWithReceipts } from "./aggregate-test-fixture"

describe("tournament selection identity", () => {
  test("rejects a selected candidate that differs from the categorical KEEP", () => {
    // given
    const input = { ...campaignWithReceipts(), selected_candidate_id: "construction-01" }

    // when
    const parsed = ResearchCampaignStateV1Schema.safeParse(input)

    // then
    expect(parsed.success).toBe(false)
  })

  test("accepts a merge child only when ordered parents and synthesis hash match the tournament directive", () => {
    // given
    const base = campaignWithReceipts()
    const synthesisBrief = "Merge both ideas."
    const synthesisBriefSha256 = sha256(synthesisBrief)
    const mergeCandidate = {
      candidate_kind: "MERGE_IDEA",
      candidate_id: "merged-01",
      created_at_revision: 7,
      child_run_id: "campaign-1::merged-01",
      child_state_revision: null,
      artifact: null,
      parent_candidate_ids: ["direct-01", "construction-01"],
      synthesis_brief: synthesisBrief,
      synthesis_brief_sha256: synthesisBriefSha256,
      attachments: [],
    }
    const tournament = {
      ...base.tournament_receipts[0],
      result: {
        kind: "DECIDED",
        actions: [
          { candidate_id: "direct-01", action: "MERGE_IDEA" },
          { candidate_id: "construction-01", action: "MERGE_IDEA" },
        ],
        synthesis_brief: synthesisBrief,
        synthesis_brief_sha256: synthesisBriefSha256,
      },
    }
    const valid = {
      ...base,
      candidates: [...base.candidates, mergeCandidate],
      job_attempts: base.job_attempts.map((job) => job.target.kind === "TOURNAMENT"
        ? { ...job, receipt: { kind: "TOURNAMENT", tournament_id: "tournament-initial", result: tournament.result } }
        : job),
      tournament_receipts: [tournament],
      selected_candidate_id: "merged-01",
    }
    const wrongParents = {
      ...valid,
      candidates: [...base.candidates, { ...mergeCandidate, parent_candidate_ids: ["construction-01", "direct-01"] }],
    }

    // when
    const accepted = ResearchCampaignStateV1Schema.safeParse(valid)
    const rejected = ResearchCampaignStateV1Schema.safeParse(wrongParents)

    // then
    expect(accepted.success).toBe(true)
    expect(rejected.success).toBe(false)
  })
})
