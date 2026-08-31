import type { CertificationGraphSources } from "../state/graph-source-validation"
import type { CertificationRoundRole, CertificationRoundRuntimeFactory } from "./extraction-coverage-types"
import type { CertificationJobProgressInput, CertificationJobProgressResult } from "../scheduler"

export type WitnessVerificationContext = Readonly<{
  readonly parent_session_id: string
  readonly sources: CertificationGraphSources
  readonly profile_sha256: string
  readonly reference_sha256: string
  readonly certification_profile_sha256: string
  readonly witness_role: CertificationRoundRole
}>

type WitnessVerificationOrchestrationBase = Readonly<{
  readonly context: WitnessVerificationContext
}>

export type WitnessVerificationOrchestrationInput = WitnessVerificationOrchestrationBase & (
  | Readonly<{
      readonly create_job_runtime: CertificationRoundRuntimeFactory
      readonly progress_job?: (input: CertificationJobProgressInput) => Promise<CertificationJobProgressResult>
    }>
  | Readonly<{
      readonly create_job_runtime?: CertificationRoundRuntimeFactory
      readonly progress_job: (input: CertificationJobProgressInput) => Promise<CertificationJobProgressResult>
    }>
)
