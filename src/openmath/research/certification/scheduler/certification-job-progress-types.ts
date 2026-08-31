import type { CertificationJobAttempt } from "../state/jobs"
import type {
  CertificationJobPersistenceErrorCode,
  CertificationJobRuntime,
} from "./certification-job-runtime-types"
import type { CertificationReconciliationFailure } from "./reconcile-certification-job"

export type CompletedCertificationJob = Extract<CertificationJobAttempt, { readonly phase: "COMPLETED" }>
export type FailedCertificationJob = CompletedCertificationJob & Readonly<{
  readonly receipt: Extract<CompletedCertificationJob["receipt"], { readonly kind: "ERROR" }>
}>

export type CertificationJobProgressInput = Readonly<{
  readonly parent_session_id: string
  readonly attempt: CertificationJobAttempt
  readonly system_content: string | undefined
  readonly user_prompt: string
  readonly receipt_from_output: (rawOutput: string) => CompletedCertificationJob["receipt"]
  readonly runtime: CertificationJobRuntime
}>

export type CertificationJobProgressResult =
  | Readonly<{ readonly kind: "completed"; readonly attempt: CompletedCertificationJob }>
  | Readonly<{ readonly kind: "failed"; readonly attempt: FailedCertificationJob }>
  | Readonly<{ readonly kind: "committed"; readonly attempt: Extract<CertificationJobAttempt, { readonly phase: "COMMITTED" }> }>
  | Readonly<{ readonly kind: "blocked"; readonly reason: "RECONCILIATION_AMBIGUOUS"; readonly evidence: CertificationReconciliationFailure }>
  | Readonly<{ readonly kind: "error"; readonly error_code: CertificationJobPersistenceErrorCode; readonly message: string }>
