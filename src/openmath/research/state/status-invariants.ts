import type { z } from "zod"

import type { CampaignPhase, CampaignStatus, ResearchAwaitingReason } from "./literals"

type StatusInvariantState = {
  readonly state_revision: number
  readonly phase: CampaignPhase
  readonly status: CampaignStatus
  readonly awaiting_reason: ResearchAwaitingReason | null
  readonly abort_requested: boolean
  readonly abort_reason: string | null
  readonly selected_candidate_id: string | null
  readonly dossier: { readonly content_sha256: string; readonly created_at_revision: number } | null
  readonly decision_receipt: {
    readonly decision: "approve" | "reject"
    readonly dossier_sha256: string
    readonly campaign_revision: number
  } | null
}

export function validateCampaignStatusInvariants(state: StatusInvariantState, context: z.RefinementCtx): void {
  if (state.abort_requested === false && state.abort_reason !== null) {
    context.addIssue({ code: "custom", path: ["abort_reason"], message: "Abort reason requires abort_requested" })
  }
  switch (state.status) {
    case "AWAITING_HUMAN":
      validateAwaitingReason(state, context)
      break
    case "PROMOTION_READY":
      if (state.phase !== "PROMOTION") context.addIssue({ code: "custom", path: ["phase"], message: "PROMOTION_READY requires PROMOTION phase" })
      break
    case "READY":
    case "RUNNING":
    case "BLOCKED":
    case "REJECTED":
    case "ABORTED":
      break
    default:
      assertNever(state.status)
  }
  const requiresSelection = state.phase === "DEEP_REFINEMENT" || state.phase === "PROMOTION"
  if (requiresSelection !== (state.selected_candidate_id !== null)) {
    context.addIssue({ code: "custom", path: ["selected_candidate_id"], message: "Selection is present only during refinement and promotion" })
  }
  if (state.phase !== "PROMOTION" && state.dossier !== null) {
    context.addIssue({ code: "custom", path: ["dossier"], message: "Dossier is present only during PROMOTION" })
  }
  validatePromotionReferences(state, context)
}

function validateAwaitingReason(state: StatusInvariantState, context: z.RefinementCtx): void {
  const expected = expectedAwaitingReason(state.phase)
  if (expected === null || state.awaiting_reason !== expected) {
    context.addIssue({ code: "custom", path: ["awaiting_reason"], message: "Awaiting reason must match campaign phase" })
  }
  if (expected === "BEFORE_PROMOTION" && state.dossier === null) {
    context.addIssue({ code: "custom", path: ["dossier"], message: "BEFORE_PROMOTION requires a dossier" })
  } else if (expected === "BEFORE_PROMOTION" && state.dossier?.created_at_revision !== state.state_revision) {
    context.addIssue({ code: "custom", path: ["dossier", "created_at_revision"], message: "BEFORE_PROMOTION dossier must be committed at the current revision" })
  }
}

function expectedAwaitingReason(phase: CampaignPhase): ResearchAwaitingReason | null {
  switch (phase) {
    case "DISCOVERY":
      return null
    case "SCREENING":
      return "AFTER_INITIAL_SCREEN"
    case "TOURNAMENT":
      return "TOURNAMENT_NEEDS_HUMAN"
    case "DEEP_REFINEMENT":
      return "CHILD_WORKFLOW_INTERVENTION"
    case "PROMOTION":
      return "BEFORE_PROMOTION"
    default:
      return assertNever(phase)
  }
}

function validatePromotionReferences(state: StatusInvariantState, context: z.RefinementCtx): void {
  switch (state.status) {
    case "PROMOTION_READY":
      if (state.dossier === null || state.decision_receipt?.decision !== "approve") {
        context.addIssue({ code: "custom", path: ["decision_receipt"], message: "PROMOTION_READY requires an approved dossier" })
        return
      }
      if (state.decision_receipt.dossier_sha256 !== state.dossier.content_sha256) {
        context.addIssue({ code: "custom", path: ["decision_receipt", "dossier_sha256"], message: "Decision must bind the dossier hash" })
      }
      validateDossierDecisionRevision(state, context)
      return
    case "REJECTED":
      if (state.phase === "PROMOTION" && (state.decision_receipt?.decision !== "reject" || state.dossier === null)) {
        context.addIssue({ code: "custom", path: ["decision_receipt"], message: "Rejected promotion requires a rejected dossier decision" })
        return
      }
      if (state.phase !== "PROMOTION" && state.decision_receipt !== null) {
        context.addIssue({ code: "custom", path: ["decision_receipt"], message: "Rejected promotion decision requires a dossier" })
      }
      if (state.decision_receipt !== null && state.dossier !== null
        && state.decision_receipt.dossier_sha256 !== state.dossier.content_sha256) {
        context.addIssue({ code: "custom", path: ["decision_receipt", "dossier_sha256"], message: "Decision must bind the dossier hash" })
      }
      if (state.decision_receipt !== null && state.dossier !== null) validateDossierDecisionRevision(state, context)
      return
    case "READY":
    case "RUNNING":
    case "AWAITING_HUMAN":
    case "BLOCKED":
    case "ABORTED":
      if (state.decision_receipt !== null) {
      context.addIssue({ code: "custom", path: ["decision_receipt"], message: "Decision receipt is valid only for a promotion terminal" })
      }
      return
    default:
      assertNever(state.status)
  }
}

function validateDossierDecisionRevision(state: StatusInvariantState, context: z.RefinementCtx): void {
  if (state.dossier !== null && state.decision_receipt !== null
    && state.dossier.created_at_revision !== state.decision_receipt.campaign_revision) {
    context.addIssue({ code: "custom", path: ["dossier", "created_at_revision"], message: "Dossier revision must equal the decided campaign revision" })
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected campaign phase: ${String(value)}`)
}
