import type { z } from "zod"

import type { AggregateInvariantInput } from "./aggregate-invariant-input"

export function validateCampaignRevisionInvariants(state: AggregateInvariantInput, context: z.RefinementCtx): void {
  validateOrderedRevisions(state.candidates.map((candidate) => candidate.created_at_revision), state, context, "candidates")
  validateOrderedRevisions(state.job_attempts.map((job) => job.prepared_at_revision), state, context, "job_attempts")
  validateOrderedRevisions(state.screen_receipts.map((screen) => screen.campaign_revision), state, context, "screen_receipts")
  validateOrderedRevisions(state.tournament_receipts.map((receipt) => receipt.campaign_revision), state, context, "tournament_receipts")
  validateOrderedRevisions(state.amendments.map((event) => event.state_revision), state, context, "amendments")

  for (const [index, job] of state.job_attempts.entries()) {
    if (job.phase_revision > state.state_revision) addFutureIssue(context, "job_attempts", index)
  }
  if (state.dossier !== null && state.dossier.created_at_revision > state.state_revision) {
    context.addIssue({ code: "custom", path: ["dossier", "created_at_revision"], message: "Dossier revision exceeds campaign revision" })
  }
  if (state.decision_receipt !== null && state.decision_receipt.state_revision !== state.state_revision) {
    context.addIssue({ code: "custom", path: ["decision_receipt", "state_revision"], message: "Decision revision must equal campaign revision" })
  }
  if (state.decision_receipt !== null && state.decision_receipt.campaign_revision + 1 !== state.state_revision) {
    context.addIssue({ code: "custom", path: ["decision_receipt", "campaign_revision"], message: "Decision campaign revision must immediately precede its commit" })
  }
}

function validateOrderedRevisions(
  revisions: readonly number[],
  state: AggregateInvariantInput,
  context: z.RefinementCtx,
  path: string,
): void {
  let previous = -1
  for (const [index, revision] of revisions.entries()) {
    if (revision < previous) {
      context.addIssue({ code: "custom", path: [path, index], message: `${path} revisions must be append ordered` })
    }
    if (revision > state.state_revision) addFutureIssue(context, path, index)
    previous = revision
  }
}

function addFutureIssue(context: z.RefinementCtx, path: string, index: number): void {
  context.addIssue({ code: "custom", path: [path, index], message: `${path} revision exceeds campaign revision` })
}
