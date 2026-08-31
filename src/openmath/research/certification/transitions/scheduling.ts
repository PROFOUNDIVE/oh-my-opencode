import { WitnessVerificationIdSchema } from "../state/literals"
import type { AttackAttempt } from "../state/attacks"
import type { WitnessVerification } from "../state/witnesses"

export {
  buildCertificationAttackPlan,
  type CertificationAttackPlanEntry,
} from "../scheduler/attack-planner"

export type WitnessPlanEntry = Readonly<{
  readonly witness_verification_id: ReturnType<typeof WitnessVerificationIdSchema.parse>
  readonly attack_attempt_id: AttackAttempt["attack_attempt_id"]
  readonly obligation_id: AttackAttempt["obligation_id"]
  readonly node_sha256: AttackAttempt["node_sha256"]
  readonly graph_sha256: AttackAttempt["graph_sha256"]
  readonly artifact_sha256: AttackAttempt["artifact_sha256"]
  readonly witness_sha256: NonNullable<AttackAttempt["witness_sha256"]>
}>

export function buildWitnessSchedule(
  attacks: readonly AttackAttempt[],
  existing: readonly WitnessVerification[],
): readonly WitnessPlanEntry[] {
  const witnessed = new Set(existing.map((witness) => witness.attack_attempt_id))
  return attacks.filter((attack) => attack.outcome === "COUNTEREXAMPLE_FOUND")
    .flatMap((attack, index) => attack.witness_sha256 === null || witnessed.has(attack.attack_attempt_id) ? [] : [{
      witness_verification_id: WitnessVerificationIdSchema.parse(`witness-${String(index + 1).padStart(4, "0")}`),
      attack_attempt_id: attack.attack_attempt_id,
      obligation_id: attack.obligation_id,
      node_sha256: attack.node_sha256,
      graph_sha256: attack.graph_sha256,
      artifact_sha256: attack.artifact_sha256,
      witness_sha256: attack.witness_sha256,
    }])
}
