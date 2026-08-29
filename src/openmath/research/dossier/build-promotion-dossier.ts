import type { WorkflowStateV1 } from "../../workflow/state"
import { sha256 } from "../../workflow/stage-runner/sha256"
import type { CandidateDescriptor, ResearchCampaignStateV1 } from "../state"
import { PromotionDossierReferenceSchema } from "../state"
import { parseFrozenCandidateSources } from "../candidates/frozen-candidate-sources"
import {
  collectPromotionAttachments,
  promotionLineageEntry,
  selectPromotionLineage,
} from "./promotion-dossier-dependencies"
import {
  PromotionDossierV1Schema,
  type PromotionDossierV1,
} from "./promotion-dossier-schema"

export type PromotionDossierBuildResult =
  | { readonly ok: true; readonly dossier: PromotionDossierV1; readonly reference: ReturnType<typeof PromotionDossierReferenceSchema.parse> }
  | { readonly ok: false; readonly message: string }

export function buildPromotionDossier(input: Readonly<{
  readonly campaign: ResearchCampaignStateV1
  readonly child: WorkflowStateV1
}>): PromotionDossierBuildResult {
  const frozen = parseFrozenCandidateSources(input.campaign)
  if (!frozen.ok) return invalid(frozen.message)
  const selected = input.campaign.candidates.find((candidate) => candidate.candidate_id === input.campaign.selected_candidate_id)
  const artifact = selected?.artifact
  const tournament = input.campaign.tournament_receipts[input.campaign.tournament_receipts.length - 1]
  if (input.campaign.phase !== "PROMOTION" || input.campaign.status !== "READY"
    || selected === undefined || artifact === null || tournament === undefined) {
    return invalid("Dossier readiness requires one selected promotion artifact and tournament receipt")
  }
  const childEvidence = childReviewEvidence(input.child, selected)
  if (childEvidence === null) return invalid("Dossier readiness requires the exact PASSED selected-child review evidence")
  const screens = tournament.screen_ids.map((screenId) => (
    input.campaign.screen_receipts.find((screen) => screen.screen_id === screenId)
  ))
  if (screens.some((screen) => screen === undefined)) return invalid("Dossier readiness requires every tournament screen receipt")
  const screenReceipts = screens.filter((screen) => screen !== undefined)
  const lineageCandidates = selectPromotionLineage(input.campaign.candidates, selected)
  if (lineageCandidates === null) return invalid("Dossier readiness requires complete selected candidate lineage")
  const createdAtRevision = input.campaign.state_revision + 1
  const dossierId = `dossier-${input.campaign.campaign_id}`
  const dossier = PromotionDossierV1Schema.parse({
    schema_version: 1,
    dossier_id: dossierId,
    campaign_id: input.campaign.campaign_id,
    created_at_revision: createdAtRevision,
    selected_artifact: artifact,
    objective_sha256: input.campaign.source_snapshot.objective.sha256,
    profile_sha256: input.campaign.source_snapshot.profile.sha256,
    reference_sha256: input.campaign.source_snapshot.references.sha256,
    candidate_lineage: lineageCandidates.map(promotionLineageEntry),
    screen_receipts: screenReceipts,
    tournament_receipt: tournament,
    child_workflow_review_evidence: childEvidence,
    remaining_uncertainties: {
      blocking_issues: screenReceipts.map((screen) => ({ screen_id: screen.screen_id, values: screen.blocking_issues })),
      unresolved_obligations: screenReceipts.map((screen) => ({ screen_id: screen.screen_id, values: screen.unresolved_obligations })),
      assumptions: screenReceipts.map((screen) => ({ screen_id: screen.screen_id, values: screen.assumptions })),
    },
    attachments: collectPromotionAttachments(input.campaign.attachments, lineageCandidates, screenReceipts),
    canonical: false,
    mathematical_correctness_certified: false,
    human_approval_required: true,
  })
  const serializedBytes = JSON.stringify(dossier)
  return {
    ok: true,
    dossier,
    reference: PromotionDossierReferenceSchema.parse({
      dossier_id: dossierId,
      campaign_id: input.campaign.campaign_id,
      created_at_revision: createdAtRevision,
      selected_candidate_id: selected.candidate_id,
      artifact,
      objective_sha256: dossier.objective_sha256,
      profile_sha256: dossier.profile_sha256,
      reference_sha256: dossier.reference_sha256,
      serialized_bytes: serializedBytes,
      content_sha256: sha256(serializedBytes),
      storage_ref: `campaign-state://dossiers/${dossierId}`,
      attachments: dossier.attachments,
    }),
  }
}

function childReviewEvidence(child: WorkflowStateV1, selected: CandidateDescriptor) {
  const artifact = selected.artifact
  const latestReview = child.latest_review
  const finalHistoryReview = child.review_history[child.review_history.length - 1]
  const finalAttempt = child.dispatch_attempts.findLast((attempt) => attempt.phase === "COMMITTED" && attempt.stage === "REVIEW")
  if (child.status !== "PASSED" || artifact === null || child.run_id !== selected.child_run_id
    || child.state_revision !== artifact.child_state_revision || child.artifact?.sha256 !== artifact.sha256
    || latestReview === null || finalHistoryReview === undefined || finalAttempt?.phase !== "COMMITTED"
    || finalAttempt.receipt.kind !== "REVIEW"
    || JSON.stringify(latestReview) !== JSON.stringify(finalHistoryReview)
    || JSON.stringify(latestReview) !== JSON.stringify(finalAttempt.receipt.review)) return null
  return {
    child_run_id: selected.child_run_id,
    child_state_revision: child.state_revision,
    status: child.status,
    artifact_version: artifact.artifact_version,
    artifact_sha256: artifact.sha256,
    completed_review_rounds: child.completed_review_rounds,
    consecutive_passes: child.consecutive_passes,
    latest_review: latestReview,
    review_history: child.review_history,
    final_review_session_id: finalAttempt.child_session_id,
    final_review_output_sha256: finalAttempt.output_hash,
  }
}

function invalid(message: string): Extract<PromotionDossierBuildResult, { readonly ok: false }> {
  return { ok: false, message }
}
