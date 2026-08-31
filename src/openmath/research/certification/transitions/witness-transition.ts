import type { ResearchCertificationStateV1 } from "../state/schema"
import { completeCertificationOperation } from "./operation-jobs"
import { certificationFailure, certificationSuccess } from "./transition-result"
import type { CertificationTransitionEvent, CertificationTransitionResult } from "./types"

type WitnessEvent = Extract<CertificationTransitionEvent, { readonly type: "COMMIT_WITNESSES" }>

export function reduceCommitCertificationWitnesses(
  state: ResearchCertificationStateV1,
  event: WitnessEvent,
): CertificationTransitionResult {
  if (state.phase !== "WITNESS_VERIFICATION") return certificationFailure(state, "ILLEGAL_TRANSITION", "Witness commit requires witness phase")
  const completion = completeCertificationOperation(state, event.completed_jobs)
  if (!completion.ok) return completion.result
  return certificationSuccess(state, {
    ...state,
    certification_revision: completion.revision,
    status: "READY",
    active_job_ids: [],
    witness_verifications: [...state.witness_verifications, ...event.witness_verifications],
    evidence_receipts: [...state.evidence_receipts, ...event.evidence_receipts],
    job_attempts: completion.job_history,
  })
}
