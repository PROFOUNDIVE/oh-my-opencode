import { ResearchCampaignStateV1Schema, type ResearchCampaignSourceSnapshot, type ResearchCampaignStateV1 } from "../state"

export function createInitialCampaignState(input: Readonly<{
  readonly campaign_id: string
  readonly parent_session_id: string
  readonly source_snapshot: ResearchCampaignSourceSnapshot
}>): ResearchCampaignStateV1 {
  return ResearchCampaignStateV1Schema.parse({
    schema_version: 1,
    campaign_id: input.campaign_id,
    parent_session_id: input.parent_session_id,
    state_revision: 0,
    phase: "DISCOVERY",
    status: "READY",
    awaiting_reason: null,
    abort_requested: false,
    abort_reason: null,
    blocked_reason: null,
    active_job_ids: [],
    source_snapshot: input.source_snapshot,
    candidates: [],
    job_attempts: [],
    screen_receipts: [],
    tournament_receipts: [],
    amendments: [],
    selected_candidate_id: null,
    dossier: null,
    decision_receipt: null,
    attachments: [],
  })
}
