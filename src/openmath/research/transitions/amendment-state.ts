import type { CampaignAmendmentEvent, ResearchCampaignStateV1 } from "../state"
import type { CampaignPhase } from "../state"
import type { RenderedCampaignAmendment } from "./types"

type AddedAmendment = Extract<CampaignAmendmentEvent, { readonly event_type: "ADDED" }>

export function activeCampaignAmendments(state: ResearchCampaignStateV1): readonly AddedAmendment[] {
  const added = new Map<string, AddedAmendment>()
  const inactive = new Set<string>()
  for (const event of state.amendments) {
    switch (event.event_type) {
      case "ADDED":
        added.set(event.amendment_id, event)
        break
      case "CONSUMED":
      case "RETRACTED":
        inactive.add(event.amendment_id)
        break
      default:
        assertNever(event)
    }
  }
  return [...added.values()].filter((event) => !inactive.has(event.amendment_id))
}

export function renderApplicableCampaignAmendments(
  state: ResearchCampaignStateV1,
  phase: Exclude<CampaignPhase, "PROMOTION">,
): readonly RenderedCampaignAmendment[] {
  return activeCampaignAmendments(state)
    .filter((event) => scopeApplies(event.scope, phase))
    .map(({ amendment_id, kind, scope, content }) => ({ amendment_id, kind, scope, content }))
}

export function consumeApplicableCampaignAmendments(
  state: ResearchCampaignStateV1,
  phase: Exclude<CampaignPhase, "PROMOTION">,
  revision: number,
): readonly CampaignAmendmentEvent[] {
  const consumed = activeCampaignAmendments(state)
    .filter((event) => scopeApplies(event.scope, phase) && isSingleUse(event.scope))
    .map((event) => ({
      event_type: "CONSUMED" as const,
      amendment_id: event.amendment_id,
      lifecycle: "ACTIVE" as const,
      state_revision: revision,
    }))
  return [...state.amendments, ...consumed]
}

function scopeApplies(scope: AddedAmendment["scope"], phase: Exclude<CampaignPhase, "PROMOTION">): boolean {
  switch (phase) {
    case "DISCOVERY":
      return scope === "all_candidates" || scope.startsWith("candidate:")
    case "SCREENING":
      return scope === "next_screen" || scope === "all_remaining_screens"
    case "TOURNAMENT":
      return scope === "next_tournament"
    case "DEEP_REFINEMENT":
      return scope === "selected_refinement"
    default:
      return assertNever(phase)
  }
}

function isSingleUse(scope: AddedAmendment["scope"]): boolean {
  return scope !== "all_candidates" && scope !== "all_remaining_screens"
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected campaign amendment variant: ${String(value)}`)
}
