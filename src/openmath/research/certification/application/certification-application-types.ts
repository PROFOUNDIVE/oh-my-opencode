import type { WorkflowStateV1 } from "../../../workflow/state"
import type { FrozenCandidateSources } from "../../candidates/frozen-candidate-sources"
import type { ResearchCampaignStateV1 } from "../../state"
import type { ResearchCertificationStateV1 } from "../state/schema"
import type { CertificationNextAction, CertificationProfileLimits } from "../transitions"
import type { CertificationStorageIdentity } from "../storage"

export type CertificationApplicationErrorCode =
  | "CAMPAIGN_ABORTED"
  | "CAMPAIGN_ALREADY_EXISTS"
  | "CAMPAIGN_NOT_FOUND"
  | "CAMPAIGN_NOT_ELIGIBLE"
  | "CERTIFICATION_ALREADY_EXISTS"
  | "CERTIFICATION_NOT_FOUND"
  | "CHILD_WORKFLOW_FAILED"
  | "ILLEGAL_TRANSITION"
  | "PROFILE_HASH_MISMATCH"
  | "RECONCILIATION_AMBIGUOUS"
  | "SIDECAR_CLEANUP_FAILED"
  | "STALE_ARTIFACT"
  | "STALE_CERTIFICATION_REVISION"
  | "STALE_GRAPH"
  | "STALE_STATE_REVISION"
  | "STORAGE_ATOMICITY_UNAVAILABLE"
  | "STORAGE_BUSY"
  | "STORAGE_READ_FAILED"
  | "STORAGE_WRITE_FAILED"
  | "VALIDATION_ERROR"

export type CertificationApplicationFailure = Readonly<{
  readonly kind: "error"
  readonly error_code: CertificationApplicationErrorCode
  readonly message: string
  readonly reason?: "INDEX_WITHOUT_REVISION" | "REVISION_WITHOUT_INDEX" | "INVALID_IDENTITY" | "UNREADABLE_REVISION"
  readonly current_state_revision?: number
  readonly current_certification_revision?: number
}>

export type CertificationContext = Readonly<{
  readonly campaign: ResearchCampaignStateV1
  readonly child: WorkflowStateV1
  readonly sources: FrozenCandidateSources
  readonly state_identity: ResearchCertificationStateV1["selected_artifact"]
  readonly storage_identity: CertificationStorageIdentity
  readonly profile: CertificationProfileLimits
}>

export type CertificationStateResult =
  | Readonly<{ readonly kind: "ok"; readonly state: ResearchCertificationStateV1 }>
  | CertificationApplicationFailure

export type CertificationStatusResult =
  | Readonly<{
      readonly kind: "disabled"
      readonly campaign: ResearchCampaignStateV1
    }>
  | Readonly<{
      readonly kind: "ok"
      readonly campaign: ResearchCampaignStateV1
      readonly state: ResearchCertificationStateV1 | null
      readonly content_sha256: string | null
      readonly effective_status: "NOT_STARTED" | ResearchCertificationStateV1["status"] | "BEFORE_PROMOTION"
      readonly next_actions: readonly CertificationNextAction[]
    }>
  | CertificationApplicationFailure
