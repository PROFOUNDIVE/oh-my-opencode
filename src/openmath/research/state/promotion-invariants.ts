import type { z } from "zod"

import type { AggregateInvariantInput } from "./aggregate-invariant-input"
import type { CandidateArtifactReference } from "./candidates"
import { sha256 } from "../../workflow/stage-runner/sha256"
import { PromotionDossierV1Schema } from "../dossier/promotion-dossier-schema"
import {
  collectPromotionAttachments,
  promotionLineageEntry,
  selectPromotionLineage,
} from "../dossier/promotion-dossier-dependencies"

export function validateCampaignPromotionInvariants(state: AggregateInvariantInput, context: z.RefinementCtx): void {
  const dossier = state.dossier
  if (dossier !== null) {
    if (dossier.campaign_id !== state.campaign_id) addIssue(context, ["dossier", "campaign_id"], "Dossier campaign must match state")
    if (dossier.selected_candidate_id !== state.selected_candidate_id) addIssue(context, ["dossier", "selected_candidate_id"], "Dossier selection must match state")
    if (dossier.objective_sha256 !== state.source_snapshot.objective.sha256) addIssue(context, ["dossier", "objective_sha256"], "Dossier objective hash must match snapshot")
    if (dossier.profile_sha256 !== state.source_snapshot.profile.sha256) addIssue(context, ["dossier", "profile_sha256"], "Dossier profile hash must match snapshot")
    if (dossier.reference_sha256 !== state.source_snapshot.references.sha256) addIssue(context, ["dossier", "reference_sha256"], "Dossier reference hash must match snapshot")
    const selected = state.candidates.find((candidate) => candidate.candidate_id === dossier.selected_candidate_id)
    if (selected?.artifact === null || selected?.artifact === undefined || !sameArtifact(selected.artifact, dossier.artifact)) {
      addIssue(context, ["dossier", "artifact"], "Dossier artifact must match the selected candidate")
    }
    validateSerializedDossier(state, context)
  }
  const decision = state.decision_receipt
  if (decision !== null) {
    if (decision.campaign_id !== state.campaign_id) addIssue(context, ["decision_receipt", "campaign_id"], "Decision campaign must match state")
    if (dossier === null || decision.dossier_sha256 !== dossier.content_sha256) addIssue(context, ["decision_receipt", "dossier_sha256"], "Decision hash must match dossier")
    if (decision.campaign_revision + 1 !== decision.state_revision) addIssue(context, ["decision_receipt", "campaign_revision"], "Decision must bind the pre-commit campaign revision")
  }
}

function validateSerializedDossier(state: AggregateInvariantInput, context: z.RefinementCtx): void {
  const reference = state.dossier
  if (reference === null) return
  if (sha256(reference.serialized_bytes) !== reference.content_sha256) {
    addIssue(context, ["dossier", "content_sha256"], "Dossier hash must match exact serialized bytes")
    return
  }
  const parsedJson = parseJson(reference.serialized_bytes)
  const parsed = PromotionDossierV1Schema.safeParse(parsedJson)
  if (!parsed.success) {
    addIssue(context, ["dossier", "serialized_bytes"], "Dossier bytes must contain strict PromotionDossierV1 JSON")
    return
  }
  const content = parsed.data
  const latestTournament = state.tournament_receipts[state.tournament_receipts.length - 1]
  const selected = state.candidates.find((candidate) => candidate.candidate_id === state.selected_candidate_id)
  const screens = latestTournament?.screen_ids.map((screenId) => state.screen_receipts.find((screen) => screen.screen_id === screenId))
  const review = content.child_workflow_review_evidence
  const refinement = state.job_attempts.findLast((attempt) => (
    attempt.phase === "COMMITTED" && attempt.target.kind === "CANDIDATE"
    && attempt.target.candidate_id === state.selected_candidate_id && attempt.receipt.kind === "CANDIDATE_ARTIFACT"
    && attempt.prepared_at_revision > (latestTournament?.campaign_revision ?? Number.MAX_SAFE_INTEGER)
    && attempt.raw_output_sha256 === review.final_review_output_sha256
  ))
  const metadataMatches = content.dossier_id === reference.dossier_id
    && content.campaign_id === reference.campaign_id
    && content.created_at_revision === reference.created_at_revision
    && sameArtifact(content.selected_artifact, reference.artifact)
    && content.objective_sha256 === reference.objective_sha256
    && content.profile_sha256 === reference.profile_sha256
    && content.reference_sha256 === reference.reference_sha256
    && JSON.stringify(content.attachments) === JSON.stringify(reference.attachments)
  if (!metadataMatches) addIssue(context, ["dossier", "serialized_bytes"], "Dossier content must match its persisted reference")
  if (latestTournament === undefined || JSON.stringify(content.tournament_receipt) !== JSON.stringify(latestTournament)
    || screens === undefined || screens.some((screen) => screen === undefined)
    || JSON.stringify(content.screen_receipts) !== JSON.stringify(screens)) {
    addIssue(context, ["dossier", "serialized_bytes"], "Dossier screens and tournament must match persisted selection evidence")
  }
  const lineage = selected === undefined ? null : selectPromotionLineage(state.candidates, selected)
  if (lineage === null || JSON.stringify(content.candidate_lineage) !== JSON.stringify(lineage.map(promotionLineageEntry))) {
    addIssue(context, ["dossier", "serialized_bytes"], "Dossier lineage must terminate at the selected candidate")
  }
  if (refinement?.phase !== "COMMITTED" || refinement.receipt.kind !== "CANDIDATE_ARTIFACT"
    || review.child_run_id !== reference.artifact.child_run_id
    || review.child_state_revision !== reference.artifact.child_state_revision
    || review.artifact_sha256 !== reference.artifact.sha256
    || review.final_review_output_sha256 !== refinement.raw_output_sha256) {
    addIssue(context, ["dossier", "serialized_bytes"], "Dossier review evidence must match the committed selected-child completion")
  }
  const expectedUncertainties = screens === undefined || screens.some((screen) => screen === undefined)
    ? null
    : {
        blocking_issues: screens.map((screen) => ({ screen_id: screen?.screen_id, values: screen?.blocking_issues })),
        unresolved_obligations: screens.map((screen) => ({ screen_id: screen?.screen_id, values: screen?.unresolved_obligations })),
        assumptions: screens.map((screen) => ({ screen_id: screen?.screen_id, values: screen?.assumptions })),
      }
  if (expectedUncertainties === null || JSON.stringify(content.remaining_uncertainties) !== JSON.stringify(expectedUncertainties)) {
    addIssue(context, ["dossier", "serialized_bytes"], "Dossier uncertainties must match persisted screen evidence")
  }
  if (lineage === null || screens === undefined || screens.some((screen) => screen === undefined)) return
  const completeScreens = screens.filter((screen) => screen !== undefined)
  const expectedAttachments = collectPromotionAttachments(state.attachments, lineage, completeScreens)
  if (JSON.stringify(content.attachments) !== JSON.stringify(expectedAttachments)) {
    addIssue(context, ["dossier", "attachments"], "Dossier attachments must contain every selected Phase A attachment")
  }
}

function parseJson(serialized: string): unknown {
  try {
    return JSON.parse(serialized)
  } catch (error) {
    if (error instanceof SyntaxError) return null
    throw error
  }
}

function sameArtifact(left: CandidateArtifactReference, right: CandidateArtifactReference): boolean {
  return left.child_run_id === right.child_run_id
    && left.child_state_revision === right.child_state_revision
    && left.artifact_version === right.artifact_version
    && left.media_type === right.media_type
    && left.sha256 === right.sha256
}

function addIssue(context: z.RefinementCtx, path: readonly (string | number)[], message: string): void {
  context.addIssue({ code: "custom", path: [...path], message })
}
