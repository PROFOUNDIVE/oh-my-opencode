import type { z } from "zod"

import { sha256 } from "../../workflow/stage-runner/sha256"
import { parseFrozenCandidateSources } from "../candidates/frozen-candidate-sources"
import { validatePromotionDossierV1 } from "./promotion-dossier-v1-invariants"
import { validatePromotionDossierV2 } from "./promotion-dossier-v2-invariants"
import { addPromotionIssue, samePromotionArtifact } from "./promotion-invariant-helpers"
import type { ResearchCampaignStateV1 } from "./schema"

export function validateCampaignPromotionInvariants(
  state: ResearchCampaignStateV1,
  context: z.RefinementCtx,
): void {
  const dossier = state.dossier
  if (dossier !== null) {
    if (dossier.campaign_id !== state.campaign_id) addPromotionIssue(context, ["dossier", "campaign_id"], "Dossier campaign must match state")
    if (dossier.selected_candidate_id !== state.selected_candidate_id) addPromotionIssue(context, ["dossier", "selected_candidate_id"], "Dossier selection must match state")
    if (dossier.objective_sha256 !== state.source_snapshot.objective.sha256) addPromotionIssue(context, ["dossier", "objective_sha256"], "Dossier objective hash must match snapshot")
    if (dossier.profile_sha256 !== state.source_snapshot.profile.sha256) addPromotionIssue(context, ["dossier", "profile_sha256"], "Dossier profile hash must match snapshot")
    if (dossier.reference_sha256 !== state.source_snapshot.references.sha256) addPromotionIssue(context, ["dossier", "reference_sha256"], "Dossier reference hash must match snapshot")
    const selected = state.candidates.find((candidate) => candidate.candidate_id === dossier.selected_candidate_id)
    if (selected?.artifact === null || selected?.artifact === undefined || !samePromotionArtifact(selected.artifact, dossier.artifact)) {
      addPromotionIssue(context, ["dossier", "artifact"], "Dossier artifact must match the selected candidate")
    }
    if (sha256(dossier.serialized_bytes) !== dossier.content_sha256) {
      addPromotionIssue(context, ["dossier", "content_sha256"], "Dossier hash must match exact serialized bytes")
    } else {
      validatePromotionDossierVersion(state, context)
    }
  }
  const decision = state.decision_receipt
  if (decision !== null) {
    if (decision.campaign_id !== state.campaign_id) addPromotionIssue(context, ["decision_receipt", "campaign_id"], "Decision campaign must match state")
    if (dossier === null || decision.dossier_sha256 !== dossier.content_sha256) addPromotionIssue(context, ["decision_receipt", "dossier_sha256"], "Decision hash must match dossier")
    if (decision.campaign_revision + 1 !== decision.state_revision) addPromotionIssue(context, ["decision_receipt", "campaign_revision"], "Decision must bind the pre-commit campaign revision")
  }
}

function validatePromotionDossierVersion(
  state: ResearchCampaignStateV1,
  context: z.RefinementCtx,
): void {
  const frozen = parseFrozenCandidateSources(state)
  if (!frozen.ok) {
    validatePromotionDossierV1(state, context)
    return
  }
  if (frozen.sources.profile.certification === undefined) {
    validatePromotionDossierV1(state, context)
    return
  }
  validatePromotionDossierV2(state, frozen.sources, context)
}
