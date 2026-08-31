import type { z } from "zod"

import {
  CampaignAmendmentScopeSchema,
  type CampaignJobAttempt,
  type CandidateDescriptor,
  type PromotionDecisionReceipt,
  type PromotionDossierReference,
  type ResearchCampaignStateV1,
  type ScreenReceipt,
  type TournamentReceipt,
} from "../state"
import type { CertificationSelectedArtifact } from "../certification/state/identity"
import type { ResearchCertificationStateV1 } from "../certification/state/schema"
import type { OpaqueAttachmentReference } from "../state/attachments"

export type CampaignStepMode = "one_stage" | "to_checkpoint"
export type CampaignAmendmentScope = z.infer<typeof CampaignAmendmentScopeSchema>
export type CampaignAmendmentKind = "question" | "required_check" | "suspected_blocker" | "scope_change"

export type PromotionCertificationEvidence = Readonly<{
  readonly state: ResearchCertificationStateV1
  readonly content_sha256: string
  readonly observed_selected_artifact: CertificationSelectedArtifact
  readonly artifact_content_sha256: string
}>

export type CampaignChildResult =
  | { readonly status: "PASSED"; readonly candidate: CandidateDescriptor }
  | { readonly status: "AWAITING_HUMAN"; readonly candidate: CandidateDescriptor }
  | { readonly status: "BLOCKED"; readonly reason: string }
  | { readonly status: "EXHAUSTED" }
  | { readonly status: "ABORTED" }

export type CampaignTransitionEvent =
  | { readonly type: "REQUEST_STEP"; readonly mode: CampaignStepMode }
  | {
      readonly type: "ADMIT_OPERATION"
      readonly job_attempts: readonly CampaignJobAttempt[]
      readonly candidates: readonly CandidateDescriptor[]
    }
  | {
      readonly type: "COMPLETE_DISCOVERY"
      readonly job_attempts: readonly CampaignJobAttempt[]
      readonly candidates: readonly CandidateDescriptor[]
    }
  | {
      readonly type: "COMPLETE_SCREENING"
      readonly job_attempts: readonly CampaignJobAttempt[]
      readonly screen_receipts: readonly ScreenReceipt[]
    }
  | {
      readonly type: "COMPLETE_TOURNAMENT"
      readonly job_attempts: readonly CampaignJobAttempt[]
      readonly tournament_receipt: TournamentReceipt
      readonly merge_candidate: CandidateDescriptor | null
    }
  | {
      readonly type: "COMPLETE_CHILD_WORKFLOW"
      readonly job_attempts: readonly CampaignJobAttempt[]
      readonly child_result: CampaignChildResult
    }
  | { readonly type: "DOSSIER_READY"; readonly dossier: PromotionDossierReference }
  | {
      readonly type: "PUBLISH_CERTIFICATION_ATTACHMENT"
      readonly selected_artifact: CertificationSelectedArtifact
      readonly certification_profile_sha256: string
      readonly generation_id: string
      readonly certification_revision: number
      readonly attachment: OpaqueAttachmentReference
    }
  | {
      readonly type: "ADD_AMENDMENT"
      readonly kind: CampaignAmendmentKind
      readonly scope: CampaignAmendmentScope
      readonly content: string
    }
  | { readonly type: "RETRACT_AMENDMENT"; readonly amendment_id: string }
  | {
      readonly type: "PROMOTE"
      readonly decision_receipt: PromotionDecisionReceipt
      readonly certification_evidence?: PromotionCertificationEvidence
    }
  | { readonly type: "ABORT"; readonly reason: string | null }
  | { readonly type: "BLOCK"; readonly reason: string; readonly job_attempts: readonly CampaignJobAttempt[] }
  | { readonly type: "REJECT"; readonly job_attempts: readonly CampaignJobAttempt[] }

export type CampaignTransitionResult =
  | {
      readonly ok: true
      readonly directive: "none" | "execute" | "reconcile"
      readonly state: ResearchCampaignStateV1
    }
  | {
      readonly ok: false
      readonly error_code: "ILLEGAL_TRANSITION" | "VALIDATION_ERROR"
      readonly message: string
      readonly state: ResearchCampaignStateV1
    }

export type CampaignNextAction = {
  readonly action: "step_one_stage" | "step_to_checkpoint" | "amend" | "promote" | "abort"
  readonly required_state_revision: number
  readonly reason:
    | "READY_TO_RUN"
    | "RECONCILIATION_REQUIRED"
    | "RECONCILIATION_BLOCKED"
    | "HUMAN_CHECKPOINT"
    | "AMENDMENT_REQUIRED"
    | "PROMOTION_DECISION_REQUIRED"
}

export type RenderedCampaignAmendment = {
  readonly amendment_id: string
  readonly kind: CampaignAmendmentKind
  readonly scope: CampaignAmendmentScope
  readonly content: string
}

export type TransitionResult = CampaignTransitionResult
