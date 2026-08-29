import { describe, expect, test } from "bun:test"

import { ResearchCampaignStateV1Schema } from "./index"
import { campaignWithReceipts } from "./aggregate-test-fixture"

const HASH_A = "a".repeat(64)
const HASH_B = "b".repeat(64)

describe("campaign hash bindings", () => {
  test("rejects job, screen, tournament, and candidate receipt hashes that disagree with their sources", () => {
    // given
    const base = campaignWithReceipts()
    const candidateJob = base.job_attempts[0]
    const directScreen = base.screen_receipts[0]
    const tournament = base.tournament_receipts[0]
    const invalid = [
      { ...base, job_attempts: [{ ...candidateJob, profile_sha256: HASH_B }, ...base.job_attempts.slice(1)] },
      { ...base, job_attempts: [{ ...candidateJob, receipt: { ...candidateJob.receipt, artifact_sha256: HASH_B } }, ...base.job_attempts.slice(1)] },
      { ...base, screen_receipts: [{ ...directScreen, prompt_sha256: HASH_B }, ...base.screen_receipts.slice(1)] },
      { ...base, tournament_receipts: [{ ...tournament, reference_sha256: HASH_B }] },
    ]

    // when
    const results = invalid.map((state) => ResearchCampaignStateV1Schema.safeParse(state))

    // then
    expect(results.every((result) => !result.success)).toBe(true)
  })
})

describe("opaque attachment identity", () => {
  test("allows repeated references only when all five opaque fields remain identical", () => {
    // given
    const base = campaignWithReceipts()
    const attachment = opaqueAttachment(HASH_A)
    const identical = {
      ...base,
      attachments: [attachment],
      candidates: [{ ...base.candidates[0], attachments: [attachment] }, ...base.candidates.slice(1)],
    }
    const mismatched = {
      ...identical,
      candidates: [{ ...base.candidates[0], attachments: [opaqueAttachment(HASH_B)] }, ...base.candidates.slice(1)],
    }

    // when
    const accepted = ResearchCampaignStateV1Schema.safeParse(identical)
    const rejected = ResearchCampaignStateV1Schema.safeParse(mismatched)

    // then
    expect(accepted.success).toBe(true)
    expect(rejected.success).toBe(false)
  })
})

function opaqueAttachment(contentSha256: string) {
  return {
    attachment_id: "attachment-future-evidence",
    kind: "future-evidence",
    schema_version: 1,
    content_sha256: contentSha256,
    storage_ref: "campaign://attachments/future-evidence.json",
  }
}
