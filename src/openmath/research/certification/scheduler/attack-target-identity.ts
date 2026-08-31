import type { AttackAttempt } from "../state/attacks"
import type { CertificationJobAttempt } from "../state/jobs"
import type { CertificationAttackPlanEntry } from "./attack-planner"

type AttackTarget = Extract<CertificationJobAttempt["target"], { readonly kind: "ATTACK" }>

export function attackTargetMatchesPlan(target: AttackTarget, expected: CertificationAttackPlanEntry): boolean {
  return target.attack_attempt_id === expected.attack_attempt_id
    && target.obligation_id === expected.obligation_id
    && target.node_sha256 === expected.node_sha256
    && target.graph_sha256 === expected.graph_sha256
    && target.artifact_sha256 === expected.artifact_sha256
    && target.mode === expected.mode
    && target.ordinal === expected.ordinal
}

export function terminalAttackMatchesPlan(attempt: AttackAttempt, expected: CertificationAttackPlanEntry): boolean {
  return attempt.attack_attempt_id === expected.attack_attempt_id
    && attempt.obligation_id === expected.obligation_id
    && attempt.node_sha256 === expected.node_sha256
    && attempt.graph_sha256 === expected.graph_sha256
    && attempt.artifact_sha256 === expected.artifact_sha256
    && attempt.mode === expected.mode
    && attempt.ordinal === expected.ordinal
    && attempt.bounds.coverage_round === expected.bounds.coverage_round
    && attempt.bounds.mode_ordinal === expected.bounds.mode_ordinal
    && attempt.bounds.max_attacks_per_obligation === expected.bounds.max_attacks_per_obligation
    && attempt.bounds.max_active_certification_jobs === expected.bounds.max_active_certification_jobs
}
