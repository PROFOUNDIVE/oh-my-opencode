import { sha256 } from "../../../workflow/stage-runner/sha256"
import type { ResearchCertificationStateV1 } from "../state/schema"
import {
  CertificationJobAttemptSchema,
  type CertificationJobAttempt,
} from "../state/jobs"
import type { CertificationResolvedModel } from "../state/model-provenance"

type PreparedJob = Extract<CertificationJobAttempt, { readonly phase: "PREPARED" }>

export class CertificationJobPreparationError extends Error {
  readonly name = "CertificationJobPreparationError"

  constructor(readonly code: "STALE_ARTIFACT" | "STALE_GRAPH", message: string) {
    super(`${code}: ${message}`)
  }
}

export function prepareCertificationJobAttempt(input: Readonly<{
  readonly state: ResearchCertificationStateV1
  readonly job_id: string
  readonly target: CertificationJobAttempt["target"]
  readonly role: string
  readonly resolved_model: CertificationResolvedModel
  readonly prompt_sha256: string
  readonly input_sha256: string
}>): PreparedJob {
  validateTarget(input.state, input.target)
  const preparedRevision = input.state.certification_revision + 1
  const targetBytes = JSON.stringify(input.target)
  const attemptNumber = input.state.job_attempts.filter((attempt) => JSON.stringify(attempt.target) === targetBytes).length + 1
  const idempotencyKey = sha256(JSON.stringify({
    schema_version: 1,
    certification_id: input.state.certification_id,
    generation_id: input.state.generation_id,
    campaign_id: input.state.campaign_id,
    job_id: input.job_id,
    target: input.target,
    attempt_number: attemptNumber,
    prepared_at_revision: preparedRevision,
    role: input.role,
    resolved_model: input.resolved_model,
    certification_profile_sha256: input.state.certification_profile_sha256,
    prompt_sha256: input.prompt_sha256,
    reference_sha256: input.state.reference_sha256,
    input_sha256: input.input_sha256,
  }))
  const parsed = CertificationJobAttemptSchema.parse({
    job_id: input.job_id,
    job_kind: input.target.kind,
    certification_id: input.state.certification_id,
    generation_id: input.state.generation_id,
    campaign_id: input.state.campaign_id,
    target: input.target,
    attempt_number: attemptNumber,
    prepared_at_revision: preparedRevision,
    phase_revision: preparedRevision,
    idempotency_key: idempotencyKey,
    role: input.role,
    resolved_model: input.resolved_model,
    certification_profile_sha256: input.state.certification_profile_sha256,
    prompt_sha256: input.prompt_sha256,
    reference_sha256: input.state.reference_sha256,
    input_sha256: input.input_sha256,
    child_title: `[openmath-certification:${idempotencyKey}] ${input.role} ${input.state.certification_id} ${input.job_id}`,
    phase: "PREPARED",
  })
  if (parsed.phase !== "PREPARED") throw new TypeError("Prepared certification job parsed to an unexpected phase")
  return parsed
}

function validateTarget(state: ResearchCertificationStateV1, target: CertificationJobAttempt["target"]): void {
  if (target.artifact_sha256 !== state.selected_artifact.artifact_sha256) {
    throw new CertificationJobPreparationError("STALE_ARTIFACT", "Job target does not match the selected artifact")
  }
  if (!("graph_sha256" in target)) return
  const graph = state.graphs.at(-1)
  if (graph?.graph_sha256 !== target.graph_sha256) {
    throw new CertificationJobPreparationError("STALE_GRAPH", "Job target graph is not current certification evidence")
  }
  if (target.kind === "ATTACK" || target.kind === "WITNESS") {
    const node = graph.nodes.find((candidate) => candidate.obligation_id === target.obligation_id)
    if (node?.node_sha256 !== target.node_sha256) {
      throw new CertificationJobPreparationError("STALE_GRAPH", "Job target node does not match the graph")
    }
  }
  if (target.kind === "WITNESS") {
    const attack = state.attack_attempts.find((candidate) => candidate.attack_attempt_id === target.attack_attempt_id)
    if (attack?.outcome !== "COUNTEREXAMPLE_FOUND" || attack.witness_sha256 !== target.witness_sha256
      || attack.obligation_id !== target.obligation_id || attack.artifact_sha256 !== target.artifact_sha256
      || attack.graph_sha256 !== target.graph_sha256 || attack.node_sha256 !== target.node_sha256) {
      throw new CertificationJobPreparationError("STALE_GRAPH", "Witness job does not match a found attack")
    }
  }
}
