import { describe, expect, test } from "bun:test"

import { certifiedPromotionFixture } from "../certification/application/certification-application-test-fixture"
import { readyCertificationState } from "../certification/state/certification-test-fixture"
import { completeCertificationState } from "../certification/state/complete-state-test-fixture"
import { ResearchCertificationStateV1Schema } from "../certification/state/schema"
import { certificationOperationFixture } from "../certification/transitions/operation-test-fixture"
import { reduceCertificationTransition } from "../certification/transitions"
import { ResearchCampaignStateV1Schema } from "../state"
import { campaignSuccessEnvelope } from "./campaign-envelope"
import {
  EnabledCampaignSuccessEnvelopeSchema,
  enabledCampaignAnomalyEnvelope,
  enabledCampaignSuccessEnvelope,
} from "./enabled-campaign-envelope"

describe("enabled campaign envelopes", () => {
  test("keeps the Phase A serializer closed and byte-identical", () => {
    // given
    const campaign = certifiedPromotionFixture().campaign
    const legacy = campaignSuccessEnvelope(campaign)

    // when
    const parsed = EnabledCampaignSuccessEnvelopeSchema.safeParse(legacy)

    // then
    expect(parsed.success).toBe(false)
    expect(JSON.stringify(legacy)).not.toContain("certification")
  })

  test("projects NOT_STARTED without a certification revision", () => {
    // given
    const campaign = certifiedPromotionFixture().campaign

    // when
    const result = enabledCampaignSuccessEnvelope(campaign, { kind: "not_started" })

    // then
    expect(result.certification).toEqual({
      status: "NOT_STARTED",
      effective_status: "NOT_STARTED",
      certification_revision: null,
      phase: null,
      awaiting_reason: null,
      blocked_reason: null,
      content_sha256: null,
      summary: null,
      attachment: null,
      storage_anomaly: null,
      next_actions: [
        { action: "step_one_stage", required_state_revision: 10, reason: "READY_TO_RUN" },
        { action: "step_to_checkpoint", required_state_revision: 10, reason: "READY_TO_RUN" },
        { action: "abort", required_state_revision: 10, reason: "READY_TO_RUN" },
      ],
    })
  })

  test("projects initialized state with dual-revision actions", () => {
    // given
    const campaign = certifiedPromotionFixture().campaign
    const state = ResearchCertificationStateV1Schema.parse(readyCertificationState())

    // when
    const result = enabledCampaignSuccessEnvelope(campaign, {
      kind: "readable",
      state,
      content_sha256: "f".repeat(64),
      effective_status: "READY",
    })

    // then
    expect(result.certification).toMatchObject({
      status: "READY",
      effective_status: "READY",
      certification_revision: 0,
      content_sha256: "f".repeat(64),
    })
    expect(result.certification.next_actions).toEqual([
      { action: "step_one_stage", required_state_revision: 10, required_certification_revision: 0, reason: "READY_TO_RUN" },
      { action: "step_to_checkpoint", required_state_revision: 10, required_certification_revision: 0, reason: "READY_TO_RUN" },
      { action: "amend", required_state_revision: 10, required_certification_revision: 0, reason: "READY_TO_RUN" },
      { action: "abort", required_state_revision: 10, required_certification_revision: 0, reason: "READY_TO_RUN" },
    ])
  })

  test("reports storage anomaly while campaign abort remains effective", () => {
    // given
    const campaign = certifiedPromotionFixture().campaign
    const aborted = ResearchCampaignStateV1Schema.parse({
      ...campaign,
      state_revision: campaign.state_revision + 1,
      status: "ABORTED",
      abort_requested: true,
      abort_reason: "stop",
    })

    // when
    const result = enabledCampaignAnomalyEnvelope(aborted, {
      reason: "REVISION_WITHOUT_INDEX",
      message: "Certification revision exists without a generation index",
    })

    // then
    expect(result.certification).toMatchObject({
      status: "STORAGE_ANOMALY",
      effective_status: "ABORTED",
      certification_revision: null,
      storage_anomaly: {
        reason: "REVISION_WITHOUT_INDEX",
        message: "Certification revision exists without a generation index",
      },
      next_actions: [],
    })
  })

  test("keeps every bounded certification lifecycle status in the enabled branch", () => {
    // given
    const campaign = certifiedPromotionFixture().campaign
    const ready = ResearchCertificationStateV1Schema.parse(readyCertificationState())
    const operation = certificationOperationFixture()
    const prepared = reduceCertificationTransition(operation.initial, {
      type: "PREPARE_OPERATION",
      job_attempts: [operation.extraction.prepared],
      consume_amendment_ids: [],
    }, 0)
    if (!prepared.ok) throw new TypeError(prepared.message)
    const states = [
      prepared.state,
      ResearchCertificationStateV1Schema.parse({ ...ready, certification_revision: 1, status: "AWAITING_HUMAN", awaiting_reason: "COVERAGE_REVIEW_REQUIRED" }),
      ResearchCertificationStateV1Schema.parse({ ...ready, certification_revision: 1, status: "BLOCKED", blocked_reason: "STALE_GRAPH" }),
      ResearchCertificationStateV1Schema.parse(completeCertificationState()),
      ResearchCertificationStateV1Schema.parse({ ...ready, certification_revision: 1, status: "ABORTED", abort_requested: true, abort_reason: "stop" }),
    ]

    // when
    const statuses = states.map((state) => enabledCampaignSuccessEnvelope(campaign, {
      kind: "readable",
      state,
      content_sha256: "f".repeat(64),
      effective_status: state.status,
    }).certification.status)

    // then
    expect(statuses).toEqual(["RUNNING", "AWAITING_HUMAN", "BLOCKED", "COMPLETE", "ABORTED"])
  })
})
