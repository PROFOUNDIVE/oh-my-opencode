import type { CandidateDescriptor, CampaignJobAttempt, ResearchCampaignStateV1 } from "../state"
import type {
  ResearchCampaignOperationLockReadResult,
  ResearchCampaignOperationLockReleaseResult,
  ResearchCampaignOperationLockResult,
  ResearchCampaignOperationOwner,
} from "../storage"
import type { CampaignTransitionEvent } from "../transitions"
import type { CampaignApplicationResult } from "./campaign-application-result"
import type { CampaignErrorCode } from "./campaign-envelope"
import type { CampaignMutationDependencies } from "./campaign-mutation-dependencies"
import type {
  CampaignJobBlockResult,
  CampaignJobLifecycleUpdate,
  CampaignJobPersistenceResult,
} from "../scheduler/campaign-job-runtime-types"

export type CampaignOperationPlan = Readonly<{
  readonly job_attempts: readonly CampaignJobAttempt[]
  readonly candidates: readonly CandidateDescriptor[]
}>

export type CampaignOperationPlanResult =
  | { readonly ok: true; readonly plan: CampaignOperationPlan }
  | { readonly ok: false; readonly error_code: CampaignErrorCode; readonly message: string }

export type CampaignSchedulerResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error_code: CampaignErrorCode; readonly message: string }

export type CampaignSchedulerTransition = Exclude<CampaignTransitionEvent,
  | { readonly type: "REQUEST_STEP" }
  | { readonly type: "ADMIT_OPERATION" }
  | { readonly type: "ADD_AMENDMENT" }
  | { readonly type: "RETRACT_AMENDMENT" }
  | { readonly type: "PROMOTE" }
  | { readonly type: "ABORT" }
>

export type CampaignStepDependencies = CampaignMutationDependencies & Readonly<{
  readonly plan_operation: (state: ResearchCampaignStateV1) => CampaignOperationPlanResult
  readonly run_operation: (input: Readonly<{
    readonly state: ResearchCampaignStateV1
    readonly recovered_owner: ResearchCampaignOperationOwner | null
    readonly persist_job_attempt: (update: CampaignJobLifecycleUpdate) => Promise<CampaignJobPersistenceResult>
    readonly block_reconciliation: (input: Readonly<{ readonly job_id: CampaignJobAttempt["job_id"]; readonly message: string }>) => Promise<CampaignJobBlockResult>
    readonly commit_transition: (event: CampaignSchedulerTransition) => Promise<CampaignApplicationResult>
  }>) => Promise<CampaignSchedulerResult>
  readonly acquire_lock?: (request: Readonly<{
    readonly campaign_directory: string
    readonly operation_id: string
  }>) => Promise<ResearchCampaignOperationLockResult>
  readonly read_lock?: (campaignDirectory: string) => Promise<ResearchCampaignOperationLockReadResult>
  readonly release_lock?: (owner: Readonly<{
    readonly campaign_directory: string
    readonly token: string
  }>) => Promise<ResearchCampaignOperationLockReleaseResult>
}>
