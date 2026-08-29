import { describe, expect, test } from "bun:test"

import { ResearchCampaignStateV1Schema } from "./index"
import { campaignWithReceipts, screen, tournament } from "./aggregate-test-fixture"
import { candidate } from "./test-fixture"
import { decision, dossier } from "./promotion-test-fixture"

const HASH_B = "b".repeat(64)

describe("ResearchCampaignStateV1 aggregate identity", () => {
  test("accepts a fully cross-referenced ordered campaign", () => {
    // given
    const input = campaignWithReceipts()

    // when
    const parsed = ResearchCampaignStateV1Schema.safeParse(input)

    // then
    expect(parsed.success).toBe(true)
  })

  test("rejects duplicate candidate, child-run, job, screen, and tournament identities", () => {
    // given
    const base = campaignWithReceipts()
    const invalid = [
      { ...base, candidates: [...base.candidates, base.candidates[0]] },
      { ...base, candidates: [...base.candidates, { ...candidate(), candidate_id: "other-01" }] },
      { ...base, job_attempts: [...base.job_attempts, base.job_attempts[0]] },
      { ...base, screen_receipts: [...base.screen_receipts, base.screen_receipts[0]] },
      { ...base, tournament_receipts: [...base.tournament_receipts, base.tournament_receipts[0]] },
    ]

    // when
    const results = invalid.map((state) => ResearchCampaignStateV1Schema.safeParse(state))

    // then
    expect(results.every((result) => !result.success)).toBe(true)
  })

  test("rejects unknown active jobs and mismatched child, receipt, revision, tournament, or artifact references", () => {
    // given
    const base = campaignWithReceipts()
    const directScreen = base.screen_receipts[0]
    const directCandidate = base.candidates[0]
    const invalid = [
      { ...base, status: "RUNNING", active_job_ids: ["job-unknown"] },
      { ...base, candidates: [{ ...directCandidate, child_run_id: "campaign-1::other-01" }, ...base.candidates.slice(1)] },
      { ...base, screen_receipts: [{ ...directScreen, candidate_id: "unknown-01" }, ...base.screen_receipts.slice(1)] },
      { ...base, screen_receipts: [{ ...directScreen, artifact: { ...directScreen.artifact, sha256: HASH_B } }, ...base.screen_receipts.slice(1)] },
      { ...base, screen_receipts: [{ ...directScreen, campaign_revision: directScreen.campaign_revision + 1 }, ...base.screen_receipts.slice(1)] },
      { ...base, tournament_receipts: [{ ...tournament(), screen_ids: ["screen-unknown"] }] },
      { ...base, tournament_receipts: [{ ...tournament(), result: decided("unknown-01") }] },
      { ...base, tournament_receipts: [{ ...tournament(), campaign_revision: tournament().campaign_revision + 1 }] },
    ]

    // when
    const results = invalid.map((state) => ResearchCampaignStateV1Schema.safeParse(state))

    // then
    expect(results.every((result) => !result.success)).toBe(true)
  })

  test("rejects a tournament receipt whose result differs from its committed job", () => {
    // given
    const base = campaignWithReceipts()
    const input = {
      ...base,
      job_attempts: base.job_attempts.map((job) => job.target.kind === "TOURNAMENT"
        ? { ...job, receipt: { kind: "TOURNAMENT", tournament_id: "tournament-initial", result: decided("construction-01") } }
        : job),
    }

    // when
    const parsed = ResearchCampaignStateV1Schema.safeParse(input)

    // then
    expect(parsed.success).toBe(false)
  })

  test("rejects a persisted tournament result that omits an admitted survivor action", () => {
    // given
    const base = campaignWithReceipts()
    const result = decided("direct-01")
    const input = {
      ...base,
      job_attempts: base.job_attempts.map((job) => job.target.kind === "TOURNAMENT"
        ? { ...job, receipt: { kind: "TOURNAMENT", tournament_id: "tournament-initial", result } }
        : job),
      tournament_receipts: [{ ...base.tournament_receipts[0], result }],
    }

    // when
    const parsed = ResearchCampaignStateV1Schema.safeParse(input)

    // then
    expect(parsed.success).toBe(false)
  })
})

describe("ResearchCampaignStateV1 lineage and revision invariants", () => {
  test("rejects self, forward, and cyclic parent lineage", () => {
    // given
    const base = campaignWithReceipts()
    const mergeA = mergeCandidate("merge-a", ["merge-a", "direct-01"], 7)
    const mergeB = mergeCandidate("merge-b", ["merge-a", "construction-01"], 8)
    const forwardA = mergeCandidate("merge-a", ["merge-b", "direct-01"], 7)
    const invalid = [
      { ...base, candidates: [...base.candidates, mergeA] },
      { ...base, candidates: [...base.candidates, forwardA, mergeB] },
    ]

    // when
    const results = invalid.map((state) => ResearchCampaignStateV1Schema.safeParse(state))

    // then
    expect(results.every((result) => !result.success)).toBe(true)
  })

  test("rejects future and append-order rollback revisions across every campaign record", () => {
    // given
    const base = campaignWithReceipts()
    const invalid = [
      { ...base, candidates: [{ ...base.candidates[0], created_at_revision: 11 }, ...base.candidates.slice(1)] },
      { ...base, job_attempts: [{ ...base.job_attempts[0], phase_revision: 11 }, ...base.job_attempts.slice(1)] },
      { ...base, screen_receipts: [{ ...base.screen_receipts[0], campaign_revision: 11 }, ...base.screen_receipts.slice(1)] },
      { ...base, tournament_receipts: [{ ...base.tournament_receipts[0], campaign_revision: 11 }] },
      { ...base, amendments: [addedAt(11)] },
      { ...base, screen_receipts: [screen("direct-01", 5), screen("construction-01", 4)] },
    ]

    // when
    const results = invalid.map((state) => ResearchCampaignStateV1Schema.safeParse(state))

    // then
    expect(results.every((result) => !result.success)).toBe(true)
  })

  test("binds promotion references to campaign, source, selected candidate, artifact, hash, and revision", () => {
    // given
    const base = campaignWithReceipts()
    const promotion = { ...base, phase: "PROMOTION", status: "PROMOTION_READY", dossier: dossier(), decision_receipt: decision("approve") }
    const invalid = [
      { ...promotion, dossier: { ...dossier(), campaign_id: "other-campaign" } },
      { ...promotion, dossier: { ...dossier(), selected_candidate_id: "construction-01" } },
      { ...promotion, dossier: { ...dossier(), artifact: { ...dossier().artifact, sha256: HASH_B } } },
      { ...promotion, dossier: { ...dossier(), objective_sha256: HASH_B } },
      { ...promotion, decision_receipt: { ...decision("approve"), state_revision: 11 } },
    ]

    // when
    const results = invalid.map((state) => ResearchCampaignStateV1Schema.safeParse(state))

    // then
    expect(results.every((result) => !result.success)).toBe(true)
  })
})

function decided(candidateId: string) {
  return {
    kind: "DECIDED",
    actions: [{ candidate_id: candidateId, action: "KEEP" }],
    synthesis_brief: null,
    synthesis_brief_sha256: null,
  }
}

function mergeCandidate(candidateId: string, parents: readonly string[], revision: number) {
  return {
    candidate_kind: "MERGE_IDEA",
    candidate_id: candidateId,
    created_at_revision: revision,
    child_run_id: `campaign-1::${candidateId}`,
    child_state_revision: null,
    artifact: null,
    parent_candidate_ids: parents,
    synthesis_brief: "Merge both ideas.",
    synthesis_brief_sha256: "a".repeat(64),
    attachments: [],
  }
}

function addedAt(revision: number) {
  return {
    event_type: "ADDED",
    amendment_id: `amendment-${revision}`,
    kind: "question",
    scope: "candidate:direct-01",
    content: "Check the boundary.",
    lifecycle: "ACTIVE",
    state_revision: revision,
  }
}
