import type { ResearchCertificationStateV1 } from "../state/schema"
import { buildCertificationAttackPlan } from "./scheduling"
import { completeCertificationOperation } from "./operation-jobs"
import { certificationFailure, certificationSuccess } from "./transition-result"
import type { CertificationTransitionEvent, CertificationTransitionResult } from "./types"

type AttackEvent = Extract<CertificationTransitionEvent, { readonly type: "COMMIT_ATTACKS" }>

export function reduceCommitCertificationAttacks(
  state: ResearchCertificationStateV1,
  event: AttackEvent,
): CertificationTransitionResult {
  if (state.phase !== "COUNTEREXAMPLE_ATTACK") return certificationFailure(state, "ILLEGAL_TRANSITION", "Attack commit requires attack phase")
  if (event.profile.certification_profile_sha256 !== state.certification_profile_sha256) {
    return certificationFailure(state, "PROFILE_HASH_MISMATCH", "Attack profile is stale")
  }
  const graph = state.graphs.at(-1)
  const coverage = state.coverage_reviews.at(-1)
  if (graph === undefined || coverage?.verdict !== "PASS" || coverage.graph_sha256 !== graph.graph_sha256) {
    return certificationFailure(state, "STALE_GRAPH", "Attacks require current covered graph")
  }
  const completion = completeCertificationOperation(state, event.completed_jobs)
  if (!completion.ok) return completion.result
  const attacks = [...state.attack_attempts, ...event.attack_attempts]
  const plan = buildCertificationAttackPlan({ graph, coverage, profile: event.profile })
  if (attacks.length > plan.length || attacks.some((attack, index) => {
    const expected = plan[index]
    return expected === undefined || attack.attack_attempt_id !== expected.attack_attempt_id
      || attack.obligation_id !== expected.obligation_id || attack.node_sha256 !== expected.node_sha256
      || attack.graph_sha256 !== expected.graph_sha256 || attack.mode !== expected.mode || attack.ordinal !== expected.ordinal
  })) return certificationFailure(state, "VALIDATION_ERROR", "Attack results violate deterministic plan")
  return certificationSuccess(state, {
    ...state,
    certification_revision: completion.revision,
    phase: attacks.length === plan.length ? "WITNESS_VERIFICATION" : "COUNTEREXAMPLE_ATTACK",
    status: "READY",
    active_job_ids: [],
    attack_attempts: attacks,
    evidence_receipts: [...state.evidence_receipts, ...event.evidence_receipts],
    job_attempts: completion.job_history,
  })
}
