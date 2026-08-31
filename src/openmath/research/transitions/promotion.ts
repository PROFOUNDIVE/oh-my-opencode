import type { ResearchCampaignStateV1 } from "../state"
import { admitPromotionDecision } from "./promotion-approval-gate"
import { illegal, invalid, validated } from "./transition-result"
import type { CampaignTransitionEvent, CampaignTransitionResult } from "./types"

type DossierEvent = Extract<CampaignTransitionEvent, { readonly type: "DOSSIER_READY" }>
type PromoteEvent = Extract<CampaignTransitionEvent, { readonly type: "PROMOTE" }>

export function reduceDossierReady(
  state: ResearchCampaignStateV1,
  event: DossierEvent,
): CampaignTransitionResult {
  if (state.status !== "READY" || state.phase !== "PROMOTION") {
    return illegal(state, "Dossier readiness requires READY promotion")
  }
  if (!hasCommittedRefinementArtifact(state)) {
    return invalid(state, "Dossier readiness requires committed selected-child refinement evidence")
  }
  if (event.dossier.created_at_revision !== state.state_revision + 1) {
    return invalid(state, "Dossier creation revision must equal its committing campaign revision")
  }
  return validated(state, {
    ...state,
    state_revision: state.state_revision + 1,
    status: "AWAITING_HUMAN",
    awaiting_reason: "BEFORE_PROMOTION",
    dossier: event.dossier,
  })
}

function hasCommittedRefinementArtifact(
  state: Extract<ResearchCampaignStateV1, { readonly status: "READY" }>,
): boolean {
  const latestTournament = state.tournament_receipts[state.tournament_receipts.length - 1]
  const selected = state.candidates.find((candidate) => candidate.candidate_id === state.selected_candidate_id)
  if (latestTournament === undefined || selected?.artifact === null || selected?.artifact === undefined) return false
  const artifactSha256 = selected.artifact.sha256
  return state.job_attempts.some((job) => job.phase === "COMMITTED"
    && job.target.kind === "CANDIDATE"
    && job.target.candidate_id === selected.candidate_id
    && job.prepared_at_revision > latestTournament.campaign_revision
    && job.receipt.kind === "CANDIDATE_ARTIFACT"
    && job.receipt.artifact_sha256 === artifactSha256)
}

export function reducePromotionDecision(
  state: ResearchCampaignStateV1,
  event: PromoteEvent,
): CampaignTransitionResult {
  if (
    state.status !== "AWAITING_HUMAN"
    || state.phase !== "PROMOTION"
    || state.awaiting_reason !== "BEFORE_PROMOTION"
  ) {
    return illegal(state, "Promotion decision requires the before-promotion checkpoint")
  }
  const admission = admitPromotionDecision(state, event)
  if (!admission.ok) return invalid(state, admission.message)
  switch (event.decision_receipt.decision) {
    case "approve":
      return validated(state, {
        ...state,
        state_revision: state.state_revision + 1,
        status: "PROMOTION_READY",
        awaiting_reason: null,
        decision_receipt: event.decision_receipt,
      })
    case "reject":
      return validated(state, {
        ...state,
        state_revision: state.state_revision + 1,
        status: "REJECTED",
        awaiting_reason: null,
        decision_receipt: event.decision_receipt,
      })
    default:
      return assertNever(event.decision_receipt.decision)
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected promotion decision: ${String(value)}`)
}
