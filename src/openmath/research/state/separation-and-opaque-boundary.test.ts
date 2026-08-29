import { describe, expect, test } from "bun:test"

import { parseWorkflowStateV1Json, WorkflowStateV1Schema } from "../../workflow/state"
import {
  OpaqueAttachmentReferenceSchema,
  parseResearchCampaignStateV1,
  parseResearchCampaignStateV1Json,
  ResearchCampaignStateV1Schema,
} from "./index"
import { createResearchCampaignStateFixture } from "./test-fixture"
import { createWorkflowStateFixture } from "../../workflow/state/test-fixture"

const HASH = "a".repeat(64)

describe("workflow and campaign schema separation", () => {
  test("rejects workflow state through the campaign parser and campaign state through workflow parsers", () => {
    // given
    const workflow = createWorkflowStateFixture()
    const campaign = createResearchCampaignStateFixture()

    // when
    const workflowAsCampaign = parseResearchCampaignStateV1(workflow)
    const campaignAsWorkflow = WorkflowStateV1Schema.safeParse(campaign)
    const campaignJsonAsWorkflow = parseWorkflowStateV1Json(JSON.stringify(campaign))

    // then
    expect(workflowAsCampaign.kind).toBe("error")
    expect(campaignAsWorkflow.success).toBe(false)
    expect(campaignJsonAsWorkflow.kind).toBe("error")
  })

  test("parses unknown and JSON boundaries deterministically without retaining next_actions", () => {
    // given
    const campaign = createResearchCampaignStateFixture()
    const withPersistedActions = { ...campaign, next_actions: [] }

    // when
    const first = parseResearchCampaignStateV1(campaign)
    const second = parseResearchCampaignStateV1Json(JSON.stringify(campaign))
    const repeated = parseResearchCampaignStateV1Json(JSON.stringify(campaign))
    const rejected = parseResearchCampaignStateV1(withPersistedActions)

    // then
    expect(first.kind).toBe("ok")
    expect(second).toEqual(repeated)
    expect(second.kind === "ok" && JSON.stringify(second.state)).toBe(first.kind === "ok" ? JSON.stringify(first.state) : "")
    expect(rejected.kind).toBe("error")
  })

  test("returns a typed read failure for malformed JSON", () => {
    // given
    const malformed = "{"

    // when
    const parsed = parseResearchCampaignStateV1Json(malformed)

    // then
    expect(parsed).toEqual({
      kind: "error",
      error_code: "STORAGE_READ_FAILED",
      message: "Research campaign state is not valid JSON",
    })
  })
})

describe("Phase A semantic boundary", () => {
  test("rejects every interpreted attachment field while retaining exact opaque references", () => {
    // given
    const base = {
      attachment_id: "attachment-future-evidence",
      kind: "future-evidence",
      schema_version: 1,
      content_sha256: HASH,
      storage_ref: "campaign://attachments/future-evidence.json",
    }
    const semanticKeys = [
      "verification",
      "witness",
      "result",
      "obligation",
      "counterexample",
      "coverage",
      "novelty",
      "independence",
      "status",
      "dependencies",
      "invalidation",
    ]

    // when
    const accepted = OpaqueAttachmentReferenceSchema.safeParse(base)
    const injections = semanticKeys.map((key) => OpaqueAttachmentReferenceSchema.safeParse({ ...base, [key]: {} }))

    // then
    expect(accepted.success).toBe(true)
    expect(injections.every((result) => !result.success)).toBe(true)
  })

  test("rejects Phase B-D aggregate keys and malformed lowercase SHA-256 values", () => {
    // given
    const campaign = createResearchCampaignStateFixture()
    const semanticKeys = ["obligations", "counterexamples", "formal_verification", "coverage", "novelty", "independence_groups"]
    const semanticStates = semanticKeys.map((key) => ({ ...campaign, [key]: [] }))
    const malformedHashes = [
      { ...campaign, source_snapshot: { ...campaign.source_snapshot, profile: { ...campaign.source_snapshot.profile, sha256: "A".repeat(64) } } },
      { ...campaign, source_snapshot: { ...campaign.source_snapshot, references: { ...campaign.source_snapshot.references, sha256: "a".repeat(63) } } },
    ]

    // when
    const results = [...semanticStates, ...malformedHashes].map((state) => ResearchCampaignStateV1Schema.safeParse(state))

    // then
    expect(results.every((result) => !result.success)).toBe(true)
  })
})
