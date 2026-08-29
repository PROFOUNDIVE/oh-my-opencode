import type { OpaqueAttachmentReference } from "./attachments"
import type { CampaignAmendmentEvent } from "./amendments"
import type { CandidateDescriptor } from "./candidates"
import type { CampaignJobAttempt } from "./jobs"
import type { CampaignId, CampaignJobId, CandidateId } from "./literals"
import type { PromotionDecisionReceipt, PromotionDossierReference } from "./promotion-references"
import type { ScreenReceipt } from "./screens"
import type { ResearchCampaignSourceSnapshot } from "./source-snapshots"
import type { TournamentReceipt } from "./tournaments"

export type AggregateInvariantInput = {
  readonly campaign_id: CampaignId
  readonly state_revision: number
  readonly phase: string
  readonly status: string
  readonly source_snapshot: ResearchCampaignSourceSnapshot
  readonly candidates: readonly CandidateDescriptor[]
  readonly job_attempts: readonly CampaignJobAttempt[]
  readonly screen_receipts: readonly ScreenReceipt[]
  readonly tournament_receipts: readonly TournamentReceipt[]
  readonly amendments: readonly CampaignAmendmentEvent[]
  readonly active_job_ids: readonly CampaignJobId[]
  readonly selected_candidate_id: CandidateId | null
  readonly dossier: PromotionDossierReference | null
  readonly decision_receipt: PromotionDecisionReceipt | null
  readonly attachments: readonly OpaqueAttachmentReference[]
}
