import { sha256 } from "../../../workflow/stage-runner/sha256"
import { buildCertificationWitnessPayload } from "../adapters/witness-payload"
import type { CertificationOperationPlanResult } from "../application/certification-scheduler-contract"
import { prepareCertificationJobAttempt, CertificationJobPreparationError } from "../scheduler/prepare-certification-job-attempt"
import type { ResearchCertificationStateV1 } from "../state/schema"
import { buildWitnessSchedule } from "../transitions/scheduling"
import type { WitnessVerificationContext } from "./witness-verification-types"

export type WitnessVerificationPlanResult =
  | Readonly<{
      readonly ok: true
      readonly job_attempts: readonly ReturnType<typeof prepareCertificationJobAttempt>[]
      readonly consume_amendment_ids: readonly string[]
      readonly payload: ReturnType<typeof buildCertificationWitnessPayload>
    }>
  | Extract<CertificationOperationPlanResult, { readonly ok: false }>

export function planWitnessVerification(
  state: ResearchCertificationStateV1,
  context: WitnessVerificationContext,
): WitnessVerificationPlanResult {
  if (state.status !== "READY" || state.phase !== "WITNESS_VERIFICATION") {
    return failure("ILLEGAL_TRANSITION", "Witness planning requires a ready witness phase")
  }
  if (state.profile_sha256 !== context.profile_sha256 || state.reference_sha256 !== context.reference_sha256
    || state.certification_profile_sha256 !== context.certification_profile_sha256) {
    return failure("PROFILE_HASH_MISMATCH", "Witness context frozen identity is stale")
  }
  if (JSON.stringify(state.selected_artifact) !== JSON.stringify(context.sources.artifact)) {
    return failure("STALE_ARTIFACT", "Witness context selected artifact is stale")
  }
  const scheduled = buildWitnessSchedule(state.attack_attempts, state.witness_verifications)
  const next = scheduled[0]
  if (next === undefined) return failure("ILLEGAL_TRANSITION", "No terminal found attack requires witness verification")
  if (state.job_attempts.some((job) => job.target.kind === "WITNESS" && job.target.attack_attempt_id === next.attack_attempt_id)) {
    return failure("VALIDATION_ERROR", "Found attack already has a verifier attempt")
  }
  const graph = state.graphs.find((candidate) => candidate.graph_sha256 === next.graph_sha256)
  const attack = state.attack_attempts.find((candidate) => candidate.attack_attempt_id === next.attack_attempt_id)
  if (graph === undefined || attack?.outcome !== "COUNTEREXAMPLE_FOUND") {
    return failure("STALE_GRAPH", "Witness target graph or attack is stale")
  }
  try {
    const payload = buildCertificationWitnessPayload({ graph, sources: context.sources, attack })
    const job = prepareCertificationJobAttempt({
      state,
      job_id: `cert-job-${next.witness_verification_id}`,
      target: { kind: "WITNESS", ...next },
      role: context.witness_role.agent,
      resolved_model: context.witness_role.model,
      prompt_sha256: context.witness_role.prompt.content_hash,
      input_sha256: sha256(JSON.stringify(payload)),
    })
    return { ok: true, job_attempts: [job], consume_amendment_ids: [], payload }
  } catch (error) {
    if (error instanceof CertificationJobPreparationError) return failure(error.code, error.message)
    if (error instanceof Error) return failure("VALIDATION_ERROR", error.message)
    throw error
  }
}

function failure(error_code: Extract<CertificationOperationPlanResult, { readonly ok: false }>["error_code"], message: string) {
  return { ok: false as const, error_code, message }
}
