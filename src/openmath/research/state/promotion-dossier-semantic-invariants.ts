import type { z } from "zod"

import type { PromotionDossierV1 } from "../dossier/promotion-dossier-schema"
import type { PromotionDossierV2 } from "../dossier/promotion-dossier-v2-schema"
import {
  collectPromotionAttachments,
  promotionLineageEntry,
  selectPromotionLineage,
} from "../dossier/promotion-dossier-dependencies"
import type { AggregateInvariantInput } from "./aggregate-invariant-input"
import { addPromotionIssue, samePromotionArtifact } from "./promotion-invariant-helpers"

type PromotionDossierSemanticContent = PromotionDossierV1 | PromotionDossierV2

export function validatePromotionDossierSemantics(
  state: AggregateInvariantInput,
  content: PromotionDossierSemanticContent,
  context: z.RefinementCtx,
): void {
  const reference = state.dossier
  if (reference === null) return
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
    && samePromotionArtifact(content.selected_artifact, reference.artifact)
    && content.objective_sha256 === reference.objective_sha256
    && content.profile_sha256 === reference.profile_sha256
    && content.reference_sha256 === reference.reference_sha256
    && JSON.stringify(content.attachments) === JSON.stringify(reference.attachments)
  if (!metadataMatches) addPromotionIssue(context, ["dossier", "serialized_bytes"], "Dossier content must match its persisted reference")
  if (latestTournament === undefined || JSON.stringify(content.tournament_receipt) !== JSON.stringify(latestTournament)
    || screens === undefined || screens.some((screen) => screen === undefined)
    || JSON.stringify(content.screen_receipts) !== JSON.stringify(screens)) {
    addPromotionIssue(context, ["dossier", "serialized_bytes"], "Dossier screens and tournament must match persisted selection evidence")
  }
  const lineage = selected === undefined ? null : selectPromotionLineage(state.candidates, selected)
  if (lineage === null || JSON.stringify(content.candidate_lineage) !== JSON.stringify(lineage.map(promotionLineageEntry))) {
    addPromotionIssue(context, ["dossier", "serialized_bytes"], "Dossier lineage must terminate at the selected candidate")
  }
  if (refinement?.phase !== "COMMITTED" || refinement.receipt.kind !== "CANDIDATE_ARTIFACT"
    || review.child_run_id !== reference.artifact.child_run_id
    || review.child_state_revision !== reference.artifact.child_state_revision
    || review.artifact_sha256 !== reference.artifact.sha256
    || review.final_review_output_sha256 !== refinement.raw_output_sha256) {
    addPromotionIssue(context, ["dossier", "serialized_bytes"], "Dossier review evidence must match the committed selected-child completion")
  }
  const expectedUncertainties = screens === undefined || screens.some((screen) => screen === undefined)
    ? null
    : {
        blocking_issues: screens.map((screen) => ({ screen_id: screen?.screen_id, values: screen?.blocking_issues })),
        unresolved_obligations: screens.map((screen) => ({ screen_id: screen?.screen_id, values: screen?.unresolved_obligations })),
        assumptions: screens.map((screen) => ({ screen_id: screen?.screen_id, values: screen?.assumptions })),
      }
  if (expectedUncertainties === null || JSON.stringify(content.remaining_uncertainties) !== JSON.stringify(expectedUncertainties)) {
    addPromotionIssue(context, ["dossier", "serialized_bytes"], "Dossier uncertainties must match persisted screen evidence")
  }
  if (lineage === null || screens === undefined || screens.some((screen) => screen === undefined)) return
  const completeScreens = screens.filter((screen) => screen !== undefined)
  const expectedAttachments = collectPromotionAttachments(state.attachments, lineage, completeScreens)
  if (JSON.stringify(content.attachments) !== JSON.stringify(expectedAttachments)) {
    addPromotionIssue(context, ["dossier", "attachments"], "Dossier attachments must contain every selected Phase A attachment")
  }
}
