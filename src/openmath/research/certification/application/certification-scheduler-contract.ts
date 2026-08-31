import type { ResearchCampaignOperationOwner } from "../../storage"
import type { CertificationJobAttempt } from "../state/jobs"
import type { ResearchCertificationStateV1 } from "../state/schema"
import type {
  CertificationJobBlockResult,
  CertificationJobLifecycleUpdate,
  CertificationJobPersistenceResult,
  CertificationReconciliationFailure,
} from "../scheduler"
import type { CertificationStorageIdentityInput } from "../storage"
import type { CertificationCampaignGuard } from "../storage/campaign-guard"
import type { CertificationTransitionEvent } from "../transitions"
import type { CertificationApplicationDependencies } from "./certification-application-dependencies"
import type { CertificationApplicationErrorCode, CertificationStateResult } from "./certification-application-types"

export type CertificationOperationPlanResult =
  | Readonly<{
      readonly ok: true
      readonly job_attempts: readonly CertificationJobAttempt[]
      readonly consume_amendment_ids: readonly string[]
    }>
  | Readonly<{ readonly ok: false; readonly error_code: CertificationApplicationErrorCode; readonly message: string }>

export type CertificationSchedulerTransition = Exclude<CertificationTransitionEvent,
  | { readonly type: "CHECK_ARTIFACT" }
  | { readonly type: "ABORT" }
  | { readonly type: "ADD_AMENDMENT" }
  | { readonly type: "RETRACT_AMENDMENT" }
  | { readonly type: "CONSUME_AMENDMENTS" }
  | { readonly type: "PREPARE_OPERATION" }
>

export type CertificationSchedulerResult =
  | Readonly<{ readonly ok: true }>
  | Readonly<{ readonly ok: false; readonly error_code: CertificationApplicationErrorCode; readonly message: string }>

export type CertificationStepDependencies = CertificationApplicationDependencies & Readonly<{
  readonly plan_operation: (state: ResearchCertificationStateV1) => CertificationOperationPlanResult
  readonly run_operation: (input: Readonly<{
    readonly state: ResearchCertificationStateV1
    readonly operation_owner: ResearchCampaignOperationOwner
    readonly recovered_owner: ResearchCampaignOperationOwner | null
    readonly persist_job_attempt: (update: CertificationJobLifecycleUpdate) => Promise<CertificationJobPersistenceResult>
    readonly block_reconciliation: (input: Readonly<{
      readonly job_id: CertificationJobAttempt["job_id"]
      readonly evidence: CertificationReconciliationFailure
    }>) => Promise<CertificationJobBlockResult>
    readonly commit_transition: (event: CertificationSchedulerTransition) => Promise<CertificationStateResult>
  }>) => Promise<CertificationSchedulerResult>
  readonly persist_job_lifecycle?: (input: Readonly<{
    readonly directory: string
    readonly identity: CertificationStorageIdentityInput
    readonly update: CertificationJobLifecycleUpdate
    readonly campaign_guard?: CertificationCampaignGuard
  }>) => Promise<CertificationJobPersistenceResult>
  readonly block_job_operation?: typeof import("../scheduler").blockCertificationJobOperation
}>
