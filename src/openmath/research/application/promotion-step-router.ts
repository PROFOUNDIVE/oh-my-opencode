import type { PromotionDossierStepDependencies } from "../dossier/promotion-dossier-step"
import type { ResearchCampaignStateV1 } from "../state"
import { getCertificationNextActions, type CertificationNextAction } from "../certification/transitions"
import { selectCertificationSource } from "../certification/application/certification-selection"
import type {
  CertificationApplicationFailure,
  CertificationStateResult,
} from "../certification/application/certification-application-types"
import type { CampaignErrorCode } from "./campaign-envelope"
import type { CampaignStateResult } from "./campaign-application-result"

export type CertificationPromotionStepDependencies = Readonly<{
  readonly step_certification: (input: Readonly<{
    readonly directory: string
    readonly campaign_id: string
    readonly expected_state_revision: number
    readonly expected_certification_revision: number | null
    readonly mode: "one_stage" | "to_checkpoint"
  }>) => Promise<CertificationStateResult>
}>

export type PromotionStepDependencies = Partial<PromotionDossierStepDependencies>
  & Partial<CertificationPromotionStepDependencies>

export type PromotionStepResult = Readonly<{
  readonly result: CampaignStateResult
  readonly certification_result: CertificationStateResult | null
  readonly certification_next_actions: readonly CertificationNextAction[] | null
}>

export async function routePromotionStep(input: Readonly<{
  readonly directory: string
  readonly campaign: ResearchCampaignStateV1
  readonly expected_certification_revision?: number | null
  readonly mode: "one_stage" | "to_checkpoint"
  readonly read_campaign: () => Promise<CampaignStateResult>
}>, dependencies: PromotionStepDependencies): Promise<PromotionStepResult> {
  const selection = selectCertificationSource(input.campaign)
  if (selection.kind === "error") return failed(selection)
  if (selection.kind === "disabled") {
    if (dependencies.prepare_dossier === undefined) {
      return campaignFailure("Promotion dossier dependencies are unavailable")
    }
    return {
      result: await dependencies.prepare_dossier({
        directory: input.directory,
        campaign_id: input.campaign.campaign_id,
        expected_state_revision: input.campaign.state_revision,
      }),
      certification_result: null,
      certification_next_actions: null,
    }
  }
  if (dependencies.step_certification === undefined) {
    return campaignFailure("Certification step dependencies are unavailable")
  }
  if (input.expected_certification_revision === undefined) {
    return campaignFailure("Expected certification revision is required")
  }
  const certification = await dependencies.step_certification({
    directory: input.directory,
    campaign_id: input.campaign.campaign_id,
    expected_state_revision: input.campaign.state_revision,
    expected_certification_revision: input.expected_certification_revision,
    mode: input.mode,
  })
  if (certification.kind === "error") return failed(certification)
  const campaign = await input.read_campaign()
  if (campaign.kind === "error") return { result: campaign, certification_result: certification, certification_next_actions: null }
  if (certification.state.status === "COMPLETE"
    && campaign.state.attachments.some((attachment) => attachment.kind === "research-certification")) {
    if (dependencies.prepare_dossier === undefined) {
      return campaignFailure("Promotion dossier dependencies are unavailable")
    }
    return {
      result: await dependencies.prepare_dossier({
        directory: input.directory,
        campaign_id: campaign.state.campaign_id,
        expected_state_revision: campaign.state.state_revision,
      }),
      certification_result: certification,
      certification_next_actions: null,
    }
  }
  const effectiveStatus = campaign.state.status === "AWAITING_HUMAN"
    && campaign.state.awaiting_reason === "BEFORE_PROMOTION"
    ? "BEFORE_PROMOTION"
    : certification.state.status
  return {
    result: campaign,
    certification_result: certification,
    certification_next_actions: getCertificationNextActions({
      effective_status: effectiveStatus,
      required_state_revision: campaign.state.state_revision,
      required_certification_revision: certification.state.certification_revision,
      has_applicable_amendment: certification.state.amendments.some((event) => event.event_type === "ADDED"),
    }),
  }
}

function failed(error: CertificationApplicationFailure): PromotionStepResult {
  return {
    result: {
      kind: "error",
      error_code: campaignErrorCode(error.error_code),
      message: error.message,
      ...(error.current_state_revision === undefined ? {} : { current_state_revision: error.current_state_revision }),
    },
    certification_result: error,
    certification_next_actions: null,
  }
}

function campaignFailure(message: string): PromotionStepResult {
  return {
    result: { kind: "error", error_code: "VALIDATION_ERROR", message },
    certification_result: null,
    certification_next_actions: null,
  }
}

function campaignErrorCode(errorCode: CertificationApplicationFailure["error_code"]): CampaignErrorCode {
  switch (errorCode) {
    case "CAMPAIGN_ALREADY_EXISTS": return "CAMPAIGN_ALREADY_EXISTS"
    case "CAMPAIGN_NOT_FOUND": return "CAMPAIGN_NOT_FOUND"
    case "CHILD_WORKFLOW_FAILED": return "CHILD_WORKFLOW_FAILED"
    case "ILLEGAL_TRANSITION": return "ILLEGAL_TRANSITION"
    case "STALE_STATE_REVISION": return "STALE_STATE_REVISION"
    case "STORAGE_ATOMICITY_UNAVAILABLE": return "STORAGE_ATOMICITY_UNAVAILABLE"
    case "STORAGE_BUSY": return "STORAGE_BUSY"
    case "STORAGE_READ_FAILED": return "STORAGE_READ_FAILED"
    case "STORAGE_WRITE_FAILED": return "STORAGE_WRITE_FAILED"
    case "VALIDATION_ERROR": return "VALIDATION_ERROR"
    case "CAMPAIGN_ABORTED": return "ABORTED"
    case "CAMPAIGN_NOT_ELIGIBLE":
    case "CERTIFICATION_ALREADY_EXISTS":
    case "CERTIFICATION_NOT_FOUND":
    case "PROFILE_HASH_MISMATCH":
    case "RECONCILIATION_AMBIGUOUS":
    case "SIDECAR_CLEANUP_FAILED":
    case "STALE_ARTIFACT":
    case "STALE_CERTIFICATION_REVISION":
    case "STALE_GRAPH":
      return "VALIDATION_ERROR"
    default:
      return assertNever(errorCode)
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected certification application error: ${String(value)}`)
}
