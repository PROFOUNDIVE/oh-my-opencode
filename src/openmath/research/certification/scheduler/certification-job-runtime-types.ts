import type { CertificationJobAttempt } from "../state/jobs"
import type { ResearchCertificationStateV1 } from "../state/schema"
import type { CertificationReconciliationFailure } from "./reconcile-certification-job"

type CompletedJob = Extract<CertificationJobAttempt, { readonly phase: "COMPLETED" }>

export type CertificationJobLifecycleUpdate =
  | Readonly<{
      readonly phase: "SESSION_CREATED"
      readonly job_id: CertificationJobAttempt["job_id"]
      readonly child_session_id: string
    }>
  | Readonly<{
      readonly phase: "PROMPT_SENT"
      readonly job_id: CertificationJobAttempt["job_id"]
      readonly child_session_id: string
    }>
  | Readonly<{
      readonly phase: "COMPLETED"
      readonly job_id: CertificationJobAttempt["job_id"]
      readonly child_session_id: string
      readonly raw_output_sha256: string
      readonly receipt: CompletedJob["receipt"]
    }>

export type CertificationJobPersistenceErrorCode =
  | "CERTIFICATION_ALREADY_EXISTS"
  | "CERTIFICATION_NOT_FOUND"
  | "CAMPAIGN_ABORTED"
  | "RECONCILIATION_AMBIGUOUS"
  | "STALE_CERTIFICATION_REVISION"
  | "STALE_STATE_REVISION"
  | "STORAGE_ATOMICITY_UNAVAILABLE"
  | "STORAGE_BUSY"
  | "STORAGE_READ_FAILED"
  | "STORAGE_WRITE_FAILED"

export type CertificationJobPersistenceResult =
  | Readonly<{
      readonly ok: true
      readonly attempt: CertificationJobAttempt
      readonly state: ResearchCertificationStateV1
    }>
  | Readonly<{
      readonly ok: false
      readonly error_code: CertificationJobPersistenceErrorCode
      readonly message: string
    }>

export type CertificationJobBlockResult =
  | Readonly<{
      readonly ok: true
      readonly state: ResearchCertificationStateV1
      readonly evidence: CertificationReconciliationFailure
    }>
  | Extract<CertificationJobPersistenceResult, { readonly ok: false }>

export type CertificationOperationOwnershipResult =
  | Readonly<{ readonly ok: true }>
  | Readonly<{
      readonly ok: false
      readonly error_code: "STORAGE_BUSY" | "STORAGE_READ_FAILED"
      readonly message: string
    }>

export type CertificationJobDispatch = Readonly<{
  readonly parent_session_id: string
  readonly child_title: string
  readonly agent_to_use: string
  readonly category_model: CertificationJobAttempt["resolved_model"]
  readonly system_content: string | undefined
  readonly user_prompt: string
  readonly prompt_marker: string
  readonly persisted_session_id: string | undefined
  readonly send_prompt: boolean
  readonly awaited_callbacks: Readonly<{
    readonly on_session_created?: (sessionID: string) => Promise<void>
    readonly on_prompt_sent?: (sessionID: string) => Promise<void>
  }>
}>

export type CertificationJobRuntime = Readonly<{
  readonly verify_operation_owner: () => Promise<CertificationOperationOwnershipResult>
  readonly persist_job_attempt: (update: CertificationJobLifecycleUpdate) => Promise<CertificationJobPersistenceResult>
  readonly block_reconciliation: (input: Readonly<{
    readonly job_id: CertificationJobAttempt["job_id"]
    readonly evidence: CertificationReconciliationFailure
  }>) => Promise<CertificationJobBlockResult>
  readonly list_children: (parentSessionID: string) => Promise<readonly Readonly<{ readonly id: string }>[]>
  readonly get_session: (sessionID: string) => Promise<Readonly<{ readonly title: string }>>
  readonly list_messages: (sessionID: string) => Promise<readonly Readonly<{ readonly role: string; readonly text: string }>[]>
  readonly dispatch: (input: CertificationJobDispatch) => Promise<unknown>
}>
