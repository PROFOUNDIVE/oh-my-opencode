import { ResearchCampaignStateV1Schema, type ResearchCampaignStateV1 } from "../state"
import type { CampaignTransitionResult } from "./types"

export function accepted(
  state: ResearchCampaignStateV1,
  directive: Extract<CampaignTransitionResult, { readonly ok: true }>["directive"] = "none",
): CampaignTransitionResult {
  return { ok: true, directive, state }
}

export function illegal(state: ResearchCampaignStateV1, message: string): CampaignTransitionResult {
  return { ok: false, error_code: "ILLEGAL_TRANSITION", message, state }
}

export function invalid(state: ResearchCampaignStateV1, message: string): CampaignTransitionResult {
  return { ok: false, error_code: "VALIDATION_ERROR", message, state }
}

export function validated(
  previous: ResearchCampaignStateV1,
  input: unknown,
): CampaignTransitionResult {
  const parsed = ResearchCampaignStateV1Schema.safeParse(input)
  if (!parsed.success) return invalid(previous, "Campaign transition would violate state invariants")
  return accepted(parsed.data)
}
