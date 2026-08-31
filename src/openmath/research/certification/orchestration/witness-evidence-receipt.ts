import { EvidenceReceiptV1Schema, type EvidenceReceiptV1 } from "../state/evidence"
import type { CertificationJobAttempt } from "../state/jobs"
import type { ResearchCertificationStateV1 } from "../state/schema"
import type { WitnessVerification } from "../state/witnesses"

type CompletedJob = Extract<CertificationJobAttempt, { readonly phase: "COMPLETED" }>
type WitnessTarget = Extract<CertificationJobAttempt["target"], { readonly kind: "WITNESS" }>
type CompletedWitnessJob = Omit<CompletedJob, "target"> & Readonly<{ readonly target: WitnessTarget }>

export function buildWitnessEvidenceReceipt(input: Readonly<{
  readonly state: ResearchCertificationStateV1
  readonly job: CompletedWitnessJob
  readonly witness: WitnessVerification
}>): EvidenceReceiptV1 {
  return EvidenceReceiptV1Schema.parse({
    schema_version: 1,
    evidence_id: `evidence-${String(input.state.evidence_receipts.length + 1).padStart(4, "0")}`,
    evidence_type: "LLM_REVIEW",
    certification_id: input.state.certification_id,
    generation_id: input.state.generation_id,
    campaign_id: input.state.campaign_id,
    certification_revision: input.witness.certification_revision,
    job_id: input.job.job_id,
    job_kind: "WITNESS",
    artifact_sha256: input.job.target.artifact_sha256,
    graph_sha256: input.job.target.graph_sha256,
    result_id: input.witness.witness_verification_id,
    prompt_sha256: input.job.prompt_sha256,
    input_sha256: input.job.input_sha256,
    output_sha256: input.job.raw_output_sha256,
    child_session_id: input.job.child_session_id,
    resolved_model: input.job.resolved_model,
  })
}
