import type { ResearchCampaignWriteLockReleaseResult } from "../../storage/storage-results"
import type { CertificationGenerationIndexV1 } from "../state/identity"
import type { ResearchCertificationStateV1 } from "../state/schema"

export type CertificationStorageFailure<Code extends string> = {
  readonly kind: "error"
  readonly error_code: Code
  readonly message: string
}

export type CertificationReadFailure = CertificationStorageFailure<"STORAGE_READ_FAILED"> & {
  readonly reason?: "INDEX_WITHOUT_REVISION" | "REVISION_WITHOUT_INDEX" | "INVALID_IDENTITY" | "UNREADABLE_REVISION"
}

export type CertificationReadResult =
  | { readonly kind: "not_started" }
  | {
      readonly kind: "ok"
      readonly state: ResearchCertificationStateV1
      readonly index: CertificationGenerationIndexV1
      readonly content_sha256: string
      readonly index_content_sha256: string
    }
  | CertificationReadFailure

export type CertificationMutationResult =
  | { readonly kind: "ok"; readonly state: ResearchCertificationStateV1 }
  | CertificationStorageFailure<
      | "CERTIFICATION_ALREADY_EXISTS"
      | "CERTIFICATION_NOT_FOUND"
      | "STORAGE_READ_FAILED"
      | "STORAGE_WRITE_FAILED"
      | "STORAGE_BUSY"
      | "STORAGE_ATOMICITY_UNAVAILABLE"
    >
  | {
      readonly kind: "error"
      readonly error_code: "STALE_CERTIFICATION_REVISION"
      readonly current_certification_revision: number
      readonly message: string
    }
  | CertificationStorageFailure<"CAMPAIGN_ABORTED">
  | {
      readonly kind: "error"
      readonly error_code: "STALE_STATE_REVISION"
      readonly current_state_revision?: number
      readonly message: string
    }

export type CertificationMutationResultWithCleanup = CertificationMutationResult | (
  Extract<CertificationMutationResult, { readonly kind: "error" }> & {
    readonly cleanup_failure: Extract<ResearchCampaignWriteLockReleaseResult, { readonly kind: "error" }>
  }
)

export type CertificationAttachmentReadResult =
  | { readonly kind: "ok"; readonly state: ResearchCertificationStateV1; readonly content_sha256: string }
  | CertificationStorageFailure<"STORAGE_READ_FAILED" | "CONTENT_HASH_MISMATCH">
