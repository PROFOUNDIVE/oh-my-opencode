import type { WorkflowStateV1 } from "../state"

export type StorageFailure<Code extends string> = {
  readonly kind: "error"
  readonly error_code: Code
  readonly message: string
}

export type WorkflowReadResult =
  | { readonly kind: "ok"; readonly state: WorkflowStateV1 }
  | StorageFailure<"RUN_NOT_FOUND" | "STORAGE_READ_FAILED">

export type WorkflowMutationResult =
  | { readonly kind: "ok"; readonly state: WorkflowStateV1 }
  | StorageFailure<
      | "RUN_NOT_FOUND"
      | "RUN_ALREADY_EXISTS"
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

export type AtomicWriteResult =
  | { readonly kind: "ok" }
  | StorageFailure<"STORAGE_WRITE_FAILED" | "STORAGE_ATOMICITY_UNAVAILABLE">

export type WriteLockResult =
  | { readonly kind: "acquired"; readonly token: string }
  | StorageFailure<"STORAGE_WRITE_FAILED" | "STORAGE_BUSY" | "STORAGE_ATOMICITY_UNAVAILABLE">

export type WriteLockReleaseResult =
  | { readonly kind: "ok" }
  | StorageFailure<"STORAGE_WRITE_FAILED" | "STORAGE_ATOMICITY_UNAVAILABLE">
