import type { AttackAttempt } from "../state/attacks"
import type { CertificationJobAttempt } from "../state/jobs"

type FoundAttack = Extract<AttackAttempt, { readonly outcome: "COUNTEREXAMPLE_FOUND" }>
type WitnessTarget = Extract<CertificationJobAttempt["target"], { readonly kind: "WITNESS" }>

export function witnessTargetMatchesAttack(target: WitnessTarget, attack: FoundAttack): boolean {
  return target.attack_attempt_id === attack.attack_attempt_id
    && target.obligation_id === attack.obligation_id
    && target.node_sha256 === attack.node_sha256
    && target.graph_sha256 === attack.graph_sha256
    && target.artifact_sha256 === attack.artifact_sha256
    && target.witness_sha256 === attack.witness_sha256
}
