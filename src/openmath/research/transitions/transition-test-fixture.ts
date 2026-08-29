import {
  CandidateDescriptorSchema,
  PromotionDecisionReceiptSchema,
  PromotionDossierReferenceSchema,
  ResearchCampaignStateV1Schema,
  type CampaignPhase,
  type CampaignStatus,
  type CandidateId,
  type CandidateDescriptor,
  type ResearchCampaignStateV1,
} from "../state"
import { campaignWithReceipts, tournament } from "../state/aggregate-test-fixture"
import { artifact, candidate, createResearchCampaignStateFixture } from "../state/test-fixture"
import { dossier } from "../state/promotion-test-fixture"
import type { TransitionResult } from "./types"


export function campaignState(input: unknown): ResearchCampaignStateV1 {
  return ResearchCampaignStateV1Schema.parse(input)
}

export function changed(result: TransitionResult): ResearchCampaignStateV1 {
  if (!result.ok) throw new Error(result.message)
  return result.state
}

export function emptyDiscoveryState(): ResearchCampaignStateV1 {
  return campaignState({
    ...createResearchCampaignStateFixture(),
    state_revision: 0,
    candidates: [],
    job_attempts: [],
  })
}

export function stateFor(phase: CampaignPhase, status: CampaignStatus): ResearchCampaignStateV1 {
  const base = phase === "DEEP_REFINEMENT" || phase === "PROMOTION"
    ? campaignWithReceipts()
    : createResearchCampaignStateFixture()
  const selected_candidate_id = phase === "DEEP_REFINEMENT" || phase === "PROMOTION" ? "direct-01" : null
  const common = { ...base, phase, status, selected_candidate_id, ...statusFields(status) }
  if (status === "AWAITING_HUMAN") {
    if (phase === "DISCOVERY") throw new TypeError("Discovery cannot await a human")
    return awaitingState(phase)
  }
  if (status === "PROMOTION_READY") {
    return campaignState({
      ...common,
      phase: "PROMOTION",
      dossier: dossier(common.state_revision - 1),
      decision_receipt: decisionReceipt(common.state_revision, "approve"),
    })
  }
  if (phase === "PROMOTION" && status === "REJECTED") {
    return campaignState({
      ...common,
      dossier: dossier(common.state_revision - 1),
      decision_receipt: decisionReceipt(common.state_revision, "reject"),
    })
  }
  return campaignState(common)
}

export function awaitingState(phase: Exclude<CampaignPhase, "DISCOVERY">): ResearchCampaignStateV1 {
  switch (phase) {
    case "SCREENING": {
      const base = campaignWithReceipts()
      return campaignState({
        ...base,
        phase,
        status: "AWAITING_HUMAN",
        awaiting_reason: "AFTER_INITIAL_SCREEN",
        selected_candidate_id: null,
        tournament_receipts: [],
        decision_receipt: null,
        dossier: null,
        ...idleFields(),
      })
    }
    case "TOURNAMENT": {
      const base = campaignWithReceipts()
      const tournamentResult = { kind: "NEEDS_HUMAN" } as const
      return campaignState({
        ...base,
        phase,
        status: "AWAITING_HUMAN",
        awaiting_reason: "TOURNAMENT_NEEDS_HUMAN",
        selected_candidate_id: null,
        job_attempts: base.job_attempts.map((job) => job.target.kind === "TOURNAMENT"
          ? { ...job, receipt: { kind: "TOURNAMENT", tournament_id: "tournament-initial", result: tournamentResult } }
          : job),
        tournament_receipts: [{ ...tournament(), result: tournamentResult }],
        ...idleFields(),
      })
    }
    case "DEEP_REFINEMENT":
      return campaignState({
        ...campaignWithReceipts(),
        phase,
        status: "AWAITING_HUMAN",
        awaiting_reason: "CHILD_WORKFLOW_INTERVENTION",
        ...idleFields(),
      })
    case "PROMOTION":
      return campaignState({
        ...campaignWithReceipts(),
        phase,
        status: "AWAITING_HUMAN",
        awaiting_reason: "BEFORE_PROMOTION",
        dossier: dossier(10),
        ...idleFields(),
      })
    default:
      return assertNever(phase)
  }
}

export function strategyCandidate(withArtifact: boolean): CandidateDescriptor {
  return CandidateDescriptorSchema.parse({
    ...candidate(),
    child_state_revision: withArtifact ? 2 : null,
    artifact: withArtifact ? artifact() : null,
  })
}

export function firstCandidate(state: ResearchCampaignStateV1): CandidateDescriptor {
  const candidate = state.candidates[0]
  if (candidate === undefined) throw new TypeError("Campaign fixture requires a candidate")
  return candidate
}

export function selectedCandidateId(state: ResearchCampaignStateV1): CandidateId {
  if (state.selected_candidate_id === null) throw new TypeError("Campaign fixture requires a selection")
  return state.selected_candidate_id
}

export function decisionReceipt(revision: number, decision: "approve" | "reject") {
  return PromotionDecisionReceiptSchema.parse({
    campaign_id: "campaign-1",
    campaign_revision: revision - 1,
    state_revision: revision,
    dossier_sha256: dossier(revision - 1).content_sha256,
    decision,
    actor_session_id: "ses_human1",
    actor_message_id: "msg_human1",
  })
}

export function dossierReference(createdAtRevision = 9) {
  return PromotionDossierReferenceSchema.parse(dossier(createdAtRevision))
}

function statusFields(status: CampaignStatus) {
  switch (status) {
    case "RUNNING":
      return { ...idleFields(), active_job_ids: ["job-discovery-direct-01"] }
    case "BLOCKED":
      return { ...idleFields(), blocked_reason: "reconciliation blocked" }
    case "ABORTED":
      return { ...idleFields(), abort_requested: true, abort_reason: "stopped" }
    case "READY":
    case "AWAITING_HUMAN":
    case "PROMOTION_READY":
    case "REJECTED":
      return idleFields()
    default:
      return assertNever(status)
  }
}

function idleFields() {
  return { abort_requested: false, abort_reason: null, blocked_reason: null, active_job_ids: [] }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected test fixture variant: ${String(value)}`)
}
