import type { ResearchCertificationStateV1 } from "../state/schema"
import type { CertificationStepMode } from "./types"

export function shouldContinueCertificationStep(
  mode: CertificationStepMode,
  state: ResearchCertificationStateV1,
): boolean {
  switch (mode) {
    case "one_stage":
      return false
    case "to_checkpoint":
      return state.status === "READY"
    default:
      return assertNever(mode)
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected certification step mode: ${String(value)}`)
}
