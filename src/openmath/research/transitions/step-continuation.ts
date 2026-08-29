import type { ResearchCampaignStateV1 } from "../state"
import type { CampaignStepMode } from "./types"

export function shouldContinueCampaignStep(mode: CampaignStepMode, state: ResearchCampaignStateV1): boolean {
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
  throw new TypeError(`Unexpected campaign step mode: ${String(value)}`)
}
