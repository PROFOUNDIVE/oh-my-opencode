import { z } from "zod"

import { CertificationSummaryV1Schema } from "../certification/state/summary"
import {
  CertificationBlockedReasonSchema,
  CertificationPhaseSchema,
} from "../certification/state/literals"
import type { ResearchCertificationStateV1 } from "../certification/state/schema"
import {
  getCertificationNextActions,
  type CertificationEffectiveStatus,
} from "../certification/transitions"
import { OpaqueAttachmentReferenceSchema, type ResearchCampaignStateV1 } from "../state"
import { CampaignSuccessEnvelopeSchema, campaignSuccessEnvelope } from "./campaign-envelope"

const CertificationStorageAnomalySchema = z.object({
  reason: z.enum([
    "INDEX_WITHOUT_REVISION",
    "REVISION_WITHOUT_INDEX",
    "INVALID_IDENTITY",
    "UNREADABLE_REVISION",
  ]).optional(),
  message: z.string(),
}).strict().readonly()

const EnabledCertificationStatusSchema = z.enum([
  "NOT_STARTED",
  "READY",
  "RUNNING",
  "AWAITING_HUMAN",
  "BLOCKED",
  "COMPLETE",
  "ABORTED",
  "STORAGE_ANOMALY",
])

const EnabledCertificationProjectionSchema = z.object({
  status: EnabledCertificationStatusSchema,
  effective_status: z.enum([
    "NOT_STARTED",
    "READY",
    "RUNNING",
    "AWAITING_HUMAN",
    "BLOCKED",
    "COMPLETE",
    "BEFORE_PROMOTION",
    "ABORTED",
  ]),
  certification_revision: z.number().int().nonnegative().nullable(),
  phase: CertificationPhaseSchema.nullable(),
  awaiting_reason: z.literal("COVERAGE_REVIEW_REQUIRED").nullable(),
  blocked_reason: CertificationBlockedReasonSchema.nullable(),
  content_sha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  summary: CertificationSummaryV1Schema.nullable(),
  attachment: OpaqueAttachmentReferenceSchema.nullable(),
  storage_anomaly: CertificationStorageAnomalySchema.nullable(),
  next_actions: z.array(z.object({
    action: z.enum(["step_one_stage", "step_to_checkpoint", "amend", "promote", "abort"]),
    required_state_revision: z.number().int().nonnegative(),
    required_certification_revision: z.number().int().nonnegative().optional(),
    reason: z.enum([
      "READY_TO_RUN",
      "RECONCILIATION_REQUIRED",
      "AMENDMENT_REQUIRED",
      "PUBLICATION_REQUIRED",
      "PROMOTION_DECISION_REQUIRED",
    ]),
  }).strict().readonly()).readonly(),
}).strict().readonly()

export const EnabledCampaignSuccessEnvelopeSchema = z.object({
  ...CampaignSuccessEnvelopeSchema.unwrap().shape,
  certification: EnabledCertificationProjectionSchema,
}).strict().readonly()

export type EnabledCampaignSuccessEnvelope = z.infer<typeof EnabledCampaignSuccessEnvelopeSchema>

export type EnabledCertificationRead =
  | Readonly<{ readonly kind: "not_started" }>
  | Readonly<{
      readonly kind: "dossier"
      readonly summary: z.infer<typeof CertificationSummaryV1Schema>
      readonly content_sha256: string
    }>
  | Readonly<{
      readonly kind: "readable"
      readonly state: ResearchCertificationStateV1
      readonly content_sha256: string
      readonly effective_status: CertificationEffectiveStatus
    }>

export function enabledCampaignSuccessEnvelope(
  campaign: ResearchCampaignStateV1,
  certification: EnabledCertificationRead,
): EnabledCampaignSuccessEnvelope {
  if (certification.kind === "not_started") {
    return parseEnabled(campaign, {
      status: "NOT_STARTED",
      effective_status: campaign.status === "ABORTED" ? "ABORTED" : "NOT_STARTED",
      certification_revision: null,
      phase: null,
      awaiting_reason: null,
      blocked_reason: null,
      content_sha256: null,
      summary: null,
      attachment: certificationAttachment(campaign),
      storage_anomaly: null,
      next_actions: campaign.status === "ABORTED" ? [] : actions(campaign, "NOT_STARTED", null, false),
    })
  }
  if (certification.kind === "dossier") {
    return parseEnabled(campaign, {
      status: "COMPLETE",
      effective_status: "COMPLETE",
      certification_revision: certification.summary.certification_revision,
      phase: "COMPLETE",
      awaiting_reason: null,
      blocked_reason: null,
      content_sha256: certification.content_sha256,
      summary: certification.summary,
      attachment: certificationAttachment(campaign),
      storage_anomaly: null,
      next_actions: [],
    })
  }
  const state = certification.state
  const effectiveStatus = campaign.status === "ABORTED" ? "ABORTED" : certification.effective_status
  return parseEnabled(campaign, {
    status: state.status,
    effective_status: effectiveStatus,
    certification_revision: state.certification_revision,
    phase: state.phase,
    awaiting_reason: state.awaiting_reason,
    blocked_reason: state.blocked_reason,
    content_sha256: certification.content_sha256,
    summary: state.summary,
    attachment: certificationAttachment(campaign),
    storage_anomaly: null,
    next_actions: actions(campaign, effectiveStatus, state.certification_revision, hasActiveAmendment(state)),
  })
}

export function enabledCampaignAnomalyEnvelope(
  campaign: ResearchCampaignStateV1,
  anomaly: Readonly<{ readonly reason?: "INDEX_WITHOUT_REVISION" | "REVISION_WITHOUT_INDEX" | "INVALID_IDENTITY" | "UNREADABLE_REVISION"; readonly message: string }>,
): EnabledCampaignSuccessEnvelope {
  const effectiveStatus = campaign.status === "ABORTED" ? "ABORTED" : "NOT_STARTED"
  return parseEnabled(campaign, {
    status: "STORAGE_ANOMALY",
    effective_status: effectiveStatus,
    certification_revision: null,
    phase: null,
    awaiting_reason: null,
    blocked_reason: null,
    content_sha256: null,
    summary: null,
    attachment: certificationAttachment(campaign),
    storage_anomaly: anomaly,
    next_actions: campaign.status === "ABORTED" ? [] : actions(campaign, "NOT_STARTED", null, false).filter(({ action }) => action === "abort"),
  })
}

function parseEnabled(campaign: ResearchCampaignStateV1, certification: z.input<typeof EnabledCertificationProjectionSchema>) {
  return EnabledCampaignSuccessEnvelopeSchema.parse({ ...campaignSuccessEnvelope(campaign), certification })
}

function actions(campaign: ResearchCampaignStateV1, status: CertificationEffectiveStatus, revision: number | null, hasAmendment: boolean) {
  return getCertificationNextActions({
    effective_status: status,
    required_state_revision: campaign.state_revision,
    required_certification_revision: revision,
    has_applicable_amendment: hasAmendment,
  })
}

function certificationAttachment(campaign: ResearchCampaignStateV1) {
  return campaign.attachments.find(({ kind }) => kind === "research-certification") ?? null
}

function hasActiveAmendment(state: ResearchCertificationStateV1): boolean {
  return state.amendments.some(({ event_type }) => event_type === "ADDED")
}
