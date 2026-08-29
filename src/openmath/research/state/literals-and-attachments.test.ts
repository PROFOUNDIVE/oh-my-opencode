import { describe, expect, test } from "bun:test"

import {
  CampaignIdSchema,
  CampaignJobIdSchema,
  CampaignPhaseSchema,
  CampaignSessionIdSchema,
  CampaignStatusSchema,
  CandidateIdSchema,
  ChildRunIdSchema,
  OpaqueAttachmentReferenceSchema,
  OpaqueAttachmentReferencesSchema,
  ResearchAwaitingReasonSchema,
} from "./index"

describe("research campaign literals and identifiers", () => {
  test("accepts exactly the Phase A phase, status, and awaiting-reason vocabulary", () => {
    // given
    const phases = ["DISCOVERY", "SCREENING", "TOURNAMENT", "DEEP_REFINEMENT", "PROMOTION"]
    const statuses = ["READY", "RUNNING", "AWAITING_HUMAN", "BLOCKED", "PROMOTION_READY", "REJECTED", "ABORTED"]
    const reasons = ["AFTER_INITIAL_SCREEN", "TOURNAMENT_NEEDS_HUMAN", "CHILD_WORKFLOW_INTERVENTION", "BEFORE_PROMOTION"]

    // when
    const parsed = {
      phases: phases.map((value) => CampaignPhaseSchema.parse(value)),
      statuses: statuses.map((value) => CampaignStatusSchema.parse(value)),
      reasons: reasons.map((value) => ResearchAwaitingReasonSchema.parse(value)),
    }

    // then
    expect(parsed).toEqual({ phases, statuses, reasons })
    expect(CampaignPhaseSchema.safeParse("FORMALIZE").success).toBe(false)
    expect(CampaignStatusSchema.safeParse("PASSED").success).toBe(false)
    expect(ResearchAwaitingReasonSchema.safeParse("CHECKPOINT").success).toBe(false)
  })

  test("brands only canonical campaign, candidate, job, child-run, and session identifiers", () => {
    // given
    const valid = [
      CampaignIdSchema.safeParse("erdos-123"),
      CandidateIdSchema.safeParse("direct-01"),
      CampaignJobIdSchema.safeParse("job-discovery-01"),
      ChildRunIdSchema.safeParse("erdos-123::direct-01"),
      CampaignSessionIdSchema.safeParse("ses_abc123XYZ"),
    ]
    const malformed = [
      CampaignIdSchema.safeParse("Erdos 123"),
      CandidateIdSchema.safeParse("../direct"),
      CampaignJobIdSchema.safeParse("discovery-01"),
      ChildRunIdSchema.safeParse("erdos-123/direct-01"),
      CampaignSessionIdSchema.safeParse("session-1"),
    ]

    // when
    const accepted = valid.every((result) => result.success)
    const rejected = malformed.every((result) => !result.success)

    // then
    expect(accepted).toBe(true)
    expect(rejected).toBe(true)
  })
})

describe("opaque attachment references", () => {
  test("accepts and freezes exactly five opaque fields", () => {
    // given
    const input = {
      attachment_id: "attachment-proof-sidecar",
      kind: "future-evidence",
      schema_version: 1,
      content_sha256: "a".repeat(64),
      storage_ref: "campaign://attachments/proof-sidecar.json",
    }

    // when
    const parsed = OpaqueAttachmentReferenceSchema.parse(input)

    // then
    expect(parsed).toEqual(input)
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.keys(parsed)).toEqual(["attachment_id", "kind", "schema_version", "content_sha256", "storage_ref"])
  })

  test("defaults the immutable attachment list to empty and rejects interpreted semantics", () => {
    // given
    const semanticAttachment = {
      attachment_id: "attachment-proof-sidecar",
      kind: "future-evidence",
      schema_version: 1,
      content_sha256: "a".repeat(64),
      storage_ref: "campaign://attachments/proof-sidecar.json",
      verification: { status: "VERIFIED" },
    }

    // when
    const defaulted = OpaqueAttachmentReferencesSchema.parse(undefined)
    const injected = OpaqueAttachmentReferenceSchema.safeParse(semanticAttachment)

    // then
    expect(defaulted).toEqual([])
    expect(Object.isFrozen(defaulted)).toBe(true)
    expect(injected.success).toBe(false)
  })
})
