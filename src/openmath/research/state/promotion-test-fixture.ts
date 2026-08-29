import { sha256 } from "../../workflow/stage-runner/sha256"
import { artifact } from "./test-fixture"

const HASH = "a".repeat(64)

export function dossier(createdAtRevision = 9) {
  const serializedBytes = JSON.stringify(dossierContent(createdAtRevision))
  return {
    dossier_id: "dossier-promotion-01",
    campaign_id: "campaign-1",
    created_at_revision: createdAtRevision,
    selected_candidate_id: "direct-01",
    artifact: artifact(),
    objective_sha256: HASH,
    profile_sha256: HASH,
    reference_sha256: HASH,
    serialized_bytes: serializedBytes,
    content_sha256: sha256(serializedBytes),
    storage_ref: "campaign://dossiers/promotion-01.json",
    attachments: [],
  }
}

export function decision(decisionValue: "approve" | "reject") {
  return {
    campaign_id: "campaign-1",
    campaign_revision: 9,
    state_revision: 10,
    dossier_sha256: dossier().content_sha256,
    decision: decisionValue,
    actor_session_id: "ses_human1",
    actor_message_id: "msg_human1",
  }
}

function dossierContent(createdAtRevision: number) {
  const screens = [screenEvidence("direct-01", 4), screenEvidence("construction-01", 5)]
  return {
    schema_version: 1,
    dossier_id: "dossier-promotion-01",
    campaign_id: "campaign-1",
    created_at_revision: createdAtRevision,
    selected_artifact: artifact(),
    objective_sha256: HASH,
    profile_sha256: HASH,
    reference_sha256: HASH,
    candidate_lineage: [{
      candidate_kind: "STRATEGY",
      candidate_id: "direct-01",
      created_at_revision: 0,
      child_run_id: "campaign-1::direct-01",
      parent_candidate_ids: [],
      strategy_id: "direct-proof",
      strategy_ordinal: 1,
    }],
    screen_receipts: screens,
    tournament_receipt: tournamentEvidence(),
    child_workflow_review_evidence: {
      child_run_id: "campaign-1::direct-01",
      child_state_revision: 2,
      status: "PASSED",
      artifact_version: 1,
      artifact_sha256: HASH,
      completed_review_rounds: 1,
      consecutive_passes: 1,
      latest_review: reviewEvidence(),
      review_history: [reviewEvidence()],
      final_review_session_id: "ses_review1",
      final_review_output_sha256: HASH,
    },
    remaining_uncertainties: {
      blocking_issues: screens.map((screen) => ({ screen_id: screen.screen_id, values: screen.blocking_issues })),
      unresolved_obligations: screens.map((screen) => ({ screen_id: screen.screen_id, values: screen.unresolved_obligations })),
      assumptions: screens.map((screen) => ({ screen_id: screen.screen_id, values: screen.assumptions })),
    },
    attachments: [],
    canonical: false,
    mathematical_correctness_certified: false,
    human_approval_required: true,
  }
}

function screenEvidence(candidateId: string, revision: number) {
  return {
    screen_id: `screen-${candidateId}`,
    job_id: `job-screen-${candidateId}`,
    campaign_revision: revision,
    candidate_id: candidateId,
    artifact: { ...artifact(), child_run_id: `campaign-1::${candidateId}` },
    screen_role: "logical-soundness",
    verdict: "VIABLE",
    blocking_issues: [],
    unresolved_obligations: [],
    assumptions: [],
    novel_elements: [],
    reviewer_session_id: `ses_screen${candidateId.replaceAll("-", "")}`,
    resolved_model: { providerID: "anthropic", modelID: "claude-opus" },
    profile_sha256: HASH,
    prompt_sha256: HASH,
    reference_sha256: HASH,
    raw_output_sha256: HASH,
    attachments: [],
  }
}

function tournamentEvidence() {
  return {
    tournament_id: "tournament-initial",
    job_id: "job-tournament-initial",
    campaign_revision: 6,
    screen_ids: ["screen-direct-01", "screen-construction-01"],
    result: {
      kind: "DECIDED",
      actions: [
        { candidate_id: "direct-01", action: "KEEP" },
        { candidate_id: "construction-01", action: "DROP" },
      ],
      synthesis_brief: null,
      synthesis_brief_sha256: null,
    },
    reviewer_session_id: "ses_tournament1",
    resolved_model: { providerID: "openai", modelID: "gpt-5" },
    profile_sha256: HASH,
    prompt_sha256: HASH,
    reference_sha256: HASH,
    raw_output_sha256: HASH,
  }
}

function reviewEvidence() {
  return {
    round: 1,
    verdict: "PASS",
    raw_report: "PASS",
    raw_report_sha256: HASH,
    findings: [],
    checks_performed: ["proof"],
    session_id: "ses_review1",
    prompt_hash: HASH,
    reference_hash: HASH,
    artifact_input_hash: HASH,
  }
}
