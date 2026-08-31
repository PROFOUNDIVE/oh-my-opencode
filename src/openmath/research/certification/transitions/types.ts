import type { z } from "zod"

import type { CertificationSelectedArtifactSchema } from "../state/identity"
import type { CertificationAttackMode } from "../state/attacks"
import type { AttackAttempt } from "../state/attacks"
import type { CertificationAmendmentScopeSchema } from "../state/amendments"
import type { CoverageReview } from "../state/coverage"
import type { EvidenceReceiptV1 } from "../state/evidence"
import type { CertificationGraph } from "../state/graph"
import type { CertificationJobAttempt } from "../state/jobs"
import type { WitnessVerification } from "../state/witnesses"
import type { CertificationBlockedReasonSchema } from "../state/literals"
import type { ResearchCertificationStateV1 } from "../state/schema"

export type CertificationStepMode = "one_stage" | "to_checkpoint"

export type CertificationTransitionEvent =
  | Readonly<{ readonly type: "CHECK_ARTIFACT"; readonly observed_selected_artifact: z.input<typeof CertificationSelectedArtifactSchema> }>
  | Readonly<{ readonly type: "ABORT"; readonly reason: string | null }>
  | Readonly<{ readonly type: "BLOCK"; readonly reason: z.input<typeof CertificationBlockedReasonSchema> }>
  | Readonly<{
      readonly type: "ADD_AMENDMENT"
      readonly kind: "question" | "required_check" | "suspected_blocker" | "scope_change"
      readonly scope: z.input<typeof CertificationAmendmentScopeSchema>
      readonly content: string
    }>
  | Readonly<{ readonly type: "RETRACT_AMENDMENT"; readonly amendment_id: string }>
  | Readonly<{ readonly type: "CONSUME_AMENDMENTS"; readonly amendment_ids: readonly string[] }>
  | Readonly<{
      readonly type: "PREPARE_OPERATION"
      readonly job_attempts: readonly CertificationJobAttempt[]
      readonly consume_amendment_ids: readonly string[]
    }>
  | Readonly<{
      readonly type: "COMMIT_EXTRACTION"
      readonly completed_jobs: readonly CertificationJobAttempt[]
      readonly graph: CertificationGraph
      readonly evidence_receipts: readonly EvidenceReceiptV1[]
    }>
  | Readonly<{
      readonly type: "COMMIT_COVERAGE"
      readonly completed_jobs: readonly CertificationJobAttempt[]
      readonly coverage: CoverageReview
      readonly evidence_receipts: readonly EvidenceReceiptV1[]
      readonly profile: CertificationProfileLimits
    }>
  | Readonly<{
      readonly type: "COMMIT_ATTACKS"
      readonly completed_jobs: readonly CertificationJobAttempt[]
      readonly attack_attempts: readonly AttackAttempt[]
      readonly evidence_receipts: readonly EvidenceReceiptV1[]
      readonly profile: CertificationProfileLimits
    }>
  | Readonly<{
      readonly type: "COMMIT_WITNESSES"
      readonly completed_jobs: readonly CertificationJobAttempt[]
      readonly witness_verifications: readonly WitnessVerification[]
      readonly evidence_receipts: readonly EvidenceReceiptV1[]
    }>
  | Readonly<{ readonly type: "COMPLETE"; readonly profile: CertificationProfileLimits }>

export type CertificationTransitionErrorCode =
  | "ILLEGAL_TRANSITION"
  | "STALE_CERTIFICATION_REVISION"
  | "STALE_ARTIFACT"
  | "STALE_GRAPH"
  | "PROFILE_HASH_MISMATCH"
  | "VALIDATION_ERROR"

export type CertificationTransitionResult =
  | Readonly<{ readonly ok: true; readonly state: ResearchCertificationStateV1 }>
  | Readonly<{
      readonly ok: false
      readonly error_code: CertificationTransitionErrorCode
      readonly message: string
      readonly state: ResearchCertificationStateV1
    }>

export type CertificationEffectiveStatus =
  | "NOT_STARTED"
  | "READY"
  | "RUNNING"
  | "AWAITING_HUMAN"
  | "BLOCKED"
  | "COMPLETE"
  | "BEFORE_PROMOTION"
  | "ABORTED"

export type CertificationNextAction = Readonly<{
  readonly action: "step_one_stage" | "step_to_checkpoint" | "amend" | "promote" | "abort"
  readonly required_state_revision: number
  readonly required_certification_revision?: number
  readonly reason:
    | "READY_TO_RUN"
    | "RECONCILIATION_REQUIRED"
    | "AMENDMENT_REQUIRED"
    | "PUBLICATION_REQUIRED"
    | "PROMOTION_DECISION_REQUIRED"
}>

export type CertificationActionContext = Readonly<{
  readonly effective_status: CertificationEffectiveStatus
  readonly required_state_revision: number
  readonly required_certification_revision: number | null
  readonly has_applicable_amendment: boolean
}>

export type CertificationProfileLimits = Readonly<{
  readonly certification_profile_sha256: string
  readonly max_obligations: number
  readonly max_coverage_rounds: number
  readonly max_coverage_findings: number
  readonly allowed_attack_modes: readonly CertificationAttackMode[]
  readonly max_attacks_per_obligation: number
  readonly max_active_certification_jobs: number
}>
