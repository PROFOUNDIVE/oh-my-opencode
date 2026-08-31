import type { CertificationGraphSources } from "../state/graph-source-validation"
import type { CertificationJobRuntime, CertificationJobProgressInput, CertificationJobProgressResult } from "../scheduler"
import type { CertificationProfileLimits } from "../transitions"
import type { CertificationStepDependencies } from "../application/certification-scheduler-contract"

export type CertificationRoundRole = Readonly<{
  readonly agent: string
  readonly model: Readonly<{ readonly providerID: string; readonly modelID: string; readonly variant?: string }>
  readonly prompt: Readonly<{ readonly content: string; readonly content_hash: string }>
}>

export type ExtractionCoverageRoundContext = Readonly<{
  readonly parent_session_id: string
  readonly sources: CertificationGraphSources
  readonly profile_sha256: string
  readonly reference_sha256: string
  readonly profile: CertificationProfileLimits
  readonly extraction_role: CertificationRoundRole
  readonly coverage_role: CertificationRoundRole
}>

export type CertificationRoundRuntimeFactory = (input: Readonly<{
  readonly operation_owner: Parameters<CertificationStepDependencies["run_operation"]>[0]["operation_owner"]
  readonly recovered_owner: Parameters<CertificationStepDependencies["run_operation"]>[0]["recovered_owner"]
  readonly persist_job_attempt: Parameters<CertificationStepDependencies["run_operation"]>[0]["persist_job_attempt"]
  readonly block_reconciliation: Parameters<CertificationStepDependencies["run_operation"]>[0]["block_reconciliation"]
}>) => CertificationJobRuntime

type ExtractionCoverageOrchestrationBase = Readonly<{
  readonly context: ExtractionCoverageRoundContext
}>

export type ExtractionCoverageOrchestrationInput = ExtractionCoverageOrchestrationBase & (
  | Readonly<{
      readonly create_job_runtime: CertificationRoundRuntimeFactory
      readonly progress_job?: (input: CertificationJobProgressInput) => Promise<CertificationJobProgressResult>
    }>
  | Readonly<{
      readonly create_job_runtime?: CertificationRoundRuntimeFactory
      readonly progress_job: (input: CertificationJobProgressInput) => Promise<CertificationJobProgressResult>
    }>
)
