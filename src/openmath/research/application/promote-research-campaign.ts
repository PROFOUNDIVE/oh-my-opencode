import { z } from "zod"

import { PromotionDecisionReceiptSchema } from "../state"
import { PromotionDossierV2Schema } from "../dossier/promotion-dossier-v2-schema"
import { readPromotionCertificationEvidence } from "../dossier/read-promotion-certification-evidence"
import { readResearchCampaignState } from "../storage"
import { reduceCampaignTransition } from "../transitions"
import { campaignErrorEnvelope } from "./campaign-envelope"
import type { PublicCampaignApplicationResult } from "./campaign-application-result"
import type { CampaignMutationDependencies } from "./campaign-mutation-dependencies"
import { staleCampaignRevision, writeCampaignTransition } from "./commit-campaign-transition"
import { stateResultEnvelope } from "./state-result-envelope"
import { certificationEnabled } from "./campaign-lifecycle-envelope"
import { enabledCampaignErrorEnvelope } from "./enabled-campaign-error-envelope"
import { enabledCampaignSuccessEnvelope } from "./enabled-campaign-envelope"
import {
  EnabledPromotionDecisionRequestSchema,
  PromotionDecisionRequestSchema,
  TrustedPromotionActorReceiptSchema,
  type TrustedPromotionActorReceipt,
} from "./promotion-decision-request"

export type PromotionDecisionDependencies = CampaignMutationDependencies & Readonly<{
  readonly trusted_actor_receipt: TrustedPromotionActorReceipt
  readonly read_certification_evidence?: typeof readPromotionCertificationEvidence
}>

export async function promoteResearchCampaign(input: unknown, dependencies: PromotionDecisionDependencies): Promise<PublicCampaignApplicationResult> {
  const actor = TrustedPromotionActorReceiptSchema.safeParse(dependencies.trusted_actor_receipt)
  if (!actor.success) return campaignErrorEnvelope({ error_code: "VALIDATION_ERROR", message: actor.error.message })
  const strictRequest = z.union([
    PromotionDecisionRequestSchema,
    EnabledPromotionDecisionRequestSchema,
  ]).safeParse(input)
  if (!strictRequest.success) return campaignErrorEnvelope({ error_code: "VALIDATION_ERROR", message: strictRequest.error.message })
  const current = await (dependencies.read_state ?? readResearchCampaignState)(strictRequest.data.directory, strictRequest.data.campaign_id)
  if (current.kind === "error") return campaignErrorEnvelope(current)
  const enabled = certificationEnabled(current.state)
  const parsedInput = enabled
    ? EnabledPromotionDecisionRequestSchema.safeParse(input)
    : PromotionDecisionRequestSchema.safeParse(input)
  if (!parsedInput.success) {
    return enabled
      ? enabledCampaignErrorEnvelope({ error_code: "VALIDATION_ERROR", message: parsedInput.error.message })
      : campaignErrorEnvelope({ error_code: "VALIDATION_ERROR", message: parsedInput.error.message })
  }
  const request = parsedInput.data
  if (current.state.state_revision !== request.expected_state_revision) {
    const stale = {
      error_code: "STALE_STATE_REVISION" as const,
      message: `Expected revision ${request.expected_state_revision}, found ${current.state.state_revision}`,
      current_state_revision: current.state.state_revision,
    }
    return enabled ? enabledCampaignErrorEnvelope(stale) : stateResultEnvelope(staleCampaignRevision(request.expected_state_revision, current.state.state_revision))
  }
  if (current.state.dossier === null || current.state.dossier.content_sha256 !== request.dossier_sha256) {
    const error = { error_code: "DOSSIER_HASH_MISMATCH" as const, message: "Promotion dossier hash does not match" }
    return enabled ? enabledCampaignErrorEnvelope(error) : campaignErrorEnvelope(error)
  }
  const decisionReceipt = PromotionDecisionReceiptSchema.safeParse({
    campaign_id: current.state.campaign_id,
    campaign_revision: current.state.state_revision,
    state_revision: current.state.state_revision + 1,
    dossier_sha256: request.dossier_sha256,
    decision: request.decision,
    actor_session_id: actor.data.session_id,
    actor_message_id: actor.data.message_id,
  })
  if (!decisionReceipt.success) {
    const error = { error_code: "VALIDATION_ERROR" as const, message: decisionReceipt.error.message }
    return enabled ? enabledCampaignErrorEnvelope(error) : campaignErrorEnvelope(error)
  }
  const enabledRequest = enabled ? EnabledPromotionDecisionRequestSchema.safeParse(request) : null
  const certificationEvidence = enabledRequest?.success === true
    ? await enabledPromotionEvidence(enabledRequest.data, current.state, dependencies)
    : { kind: "none" as const }
  if (certificationEvidence.kind === "error") return certificationEvidence.error
  const transition = reduceCampaignTransition(current.state, {
    type: "PROMOTE",
    decision_receipt: decisionReceipt.data,
    ...(certificationEvidence.kind === "approval" ? { certification_evidence: certificationEvidence.evidence } : {}),
  })
  if (!transition.ok) {
    const error = { error_code: transition.error_code, message: transition.message }
    return enabled ? enabledCampaignErrorEnvelope(error) : campaignErrorEnvelope(error)
  }
  const written = await writeCampaignTransition(request, transition.state, dependencies)
  if (written.kind === "error") return enabled ? enabledCampaignErrorEnvelope(written) : stateResultEnvelope(written)
  if (!enabled) return stateResultEnvelope(written)
  if (certificationEvidence.kind === "none") {
    return enabledCampaignErrorEnvelope({ error_code: "VALIDATION_ERROR", message: "Expected certification revision is required" })
  }
  if (certificationEvidence.kind === "dossier") {
    return enabledCampaignSuccessEnvelope(written.state, {
      kind: "dossier",
      summary: certificationEvidence.summary,
      content_sha256: certificationEvidence.content_sha256,
    })
  }
  return enabledCampaignSuccessEnvelope(written.state, {
    kind: "readable",
    state: certificationEvidence.evidence.state,
    content_sha256: certificationEvidence.evidence.content_sha256,
    effective_status: "COMPLETE",
  })
}

type EnabledPromotionEvidenceResult =
  | Readonly<{ readonly kind: "error"; readonly error: ReturnType<typeof enabledCampaignErrorEnvelope> }>
  | Readonly<{
      readonly kind: "dossier"
      readonly summary: z.infer<typeof PromotionDossierV2Schema>["certification_summary"]
      readonly content_sha256: string
    }>
  | Readonly<{
      readonly kind: "approval"
      readonly evidence: Exclude<Awaited<ReturnType<typeof readPromotionCertificationEvidence>>, { readonly kind: "error" }>
    }>

async function enabledPromotionEvidence(
  request: ReturnType<typeof EnabledPromotionDecisionRequestSchema.parse>,
  campaign: Parameters<typeof reduceCampaignTransition>[0],
  dependencies: PromotionDecisionDependencies,
): Promise<EnabledPromotionEvidenceResult> {
  const dossier = campaign.dossier
  if (dossier === null) return { kind: "error" as const, error: enabledCampaignErrorEnvelope({ error_code: "DOSSIER_HASH_MISMATCH", message: "Promotion dossier is unavailable" }) }
  const parsed = parseV2(dossier.serialized_bytes)
  if (parsed === null || parsed.certification_summary.certification_revision !== request.expected_certification_revision) {
    return { kind: "error" as const, error: enabledCampaignErrorEnvelope({
      error_code: "STALE_CERTIFICATION_REVISION",
      message: "Certification revision is stale",
      ...(parsed === null ? {} : { current_certification_revision: parsed.certification_summary.certification_revision }),
    }) }
  }
  if (request.decision === "reject") {
    return {
      kind: "dossier" as const,
      summary: parsed.certification_summary,
      content_sha256: parsed.certification_attachment.content_sha256,
    }
  }
  const evidence = await (dependencies.read_certification_evidence ?? readPromotionCertificationEvidence)({
    directory: request.directory,
    campaign_id: request.campaign_id,
    expected_state_revision: request.expected_state_revision,
  })
  if (evidence.kind === "error") {
    return { kind: "error" as const, error: enabledCampaignErrorEnvelope({ error_code: "STORAGE_READ_FAILED", message: evidence.message }) }
  }
  if (evidence.state.certification_revision !== request.expected_certification_revision) {
    return { kind: "error" as const, error: enabledCampaignErrorEnvelope({
      error_code: "STALE_CERTIFICATION_REVISION",
      message: "Certification revision is stale",
      current_certification_revision: evidence.state.certification_revision,
    }) }
  }
  return { kind: "approval" as const, evidence }
}

function parseV2(serialized: string) {
  try {
    const parsed = PromotionDossierV2Schema.safeParse(JSON.parse(serialized))
    return parsed.success ? parsed.data : null
  } catch (error) {
    if (error instanceof SyntaxError) return null
    throw error
  }
}
