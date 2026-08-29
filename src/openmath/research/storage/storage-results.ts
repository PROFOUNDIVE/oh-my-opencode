import type { ProcessStatus } from "../../workflow/storage/storage-runtime-contract"
import type { ResearchCampaignStateV1 } from "../state"

export type CampaignStorageFailure<Code extends string> = {
  readonly kind: "error"
  readonly error_code: Code
  readonly message: string
}

export type ResearchCampaignReadResult =
  | { readonly kind: "ok"; readonly state: ResearchCampaignStateV1 }
  | CampaignStorageFailure<"CAMPAIGN_NOT_FOUND" | "STORAGE_READ_FAILED">

export type ResearchCampaignMutationResult =
  | { readonly kind: "ok"; readonly state: ResearchCampaignStateV1 }
  | CampaignStorageFailure<
      | "CAMPAIGN_NOT_FOUND"
      | "CAMPAIGN_ALREADY_EXISTS"
      | "STORAGE_READ_FAILED"
      | "STORAGE_WRITE_FAILED"
      | "STORAGE_BUSY"
      | "STORAGE_ATOMICITY_UNAVAILABLE"
    >
  | {
      readonly kind: "error"
      readonly error_code: "STALE_STATE_REVISION"
      readonly current_state_revision: number
      readonly message: string
    }

export type ResearchCampaignAtomicWriteResult =
  | { readonly kind: "ok" }
  | CampaignStorageFailure<"STORAGE_WRITE_FAILED" | "STORAGE_ATOMICITY_UNAVAILABLE">

export type ResearchCampaignWriteLockResult =
  | { readonly kind: "acquired"; readonly token: string }
  | CampaignStorageFailure<"STORAGE_WRITE_FAILED" | "STORAGE_BUSY" | "STORAGE_ATOMICITY_UNAVAILABLE">

export type ResearchCampaignWriteLockReleaseResult =
  | { readonly kind: "ok" }
  | CampaignStorageFailure<"STORAGE_WRITE_FAILED" | "STORAGE_ATOMICITY_UNAVAILABLE">

export type ResearchCampaignOperationOwner = {
  readonly token: string
  readonly pid: number
  readonly operation_id: string
  readonly started_at: string
}

export type ResearchCampaignOperationLockReadResult =
  | { readonly kind: "unlocked" }
  | { readonly kind: "owned"; readonly owner: ResearchCampaignOperationOwner; readonly process_status: ProcessStatus }
  | CampaignStorageFailure<"STORAGE_READ_FAILED">

export type ResearchCampaignOperationLockResult =
  | {
      readonly kind: "acquired"
      readonly owner: ResearchCampaignOperationOwner
      readonly recovered_owner: ResearchCampaignOperationOwner | null
    }
  | CampaignStorageFailure<"STORAGE_READ_FAILED" | "STORAGE_WRITE_FAILED" | "STORAGE_BUSY" | "STORAGE_ATOMICITY_UNAVAILABLE">

export type ResearchCampaignOperationLockReleaseResult =
  | { readonly kind: "ok" }
  | CampaignStorageFailure<
      "STORAGE_READ_FAILED" | "STORAGE_WRITE_FAILED" | "STORAGE_BUSY" | "STORAGE_ATOMICITY_UNAVAILABLE"
    >
