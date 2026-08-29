const HASH = "a".repeat(64)

export function createResearchCampaignStateFixture() {
  return {
    schema_version: 1,
    campaign_id: "campaign-1",
    parent_session_id: "ses_parent1",
    state_revision: 10,
    phase: "DISCOVERY",
    status: "READY",
    awaiting_reason: null,
    abort_requested: false,
    abort_reason: null,
    blocked_reason: null,
    active_job_ids: [],
    source_snapshot: {
      objective: {
        request: { kind: "markdown", instruction: "Prove the conjecture." },
        sha256: HASH,
      },
      profile: {
        schema_version: 1,
        name: "phase-a-profile",
        serialized_bytes: "{\"name\":\"phase-a-profile\"}",
        sha256: HASH,
      },
      references: {
        schema_version: 1,
        serialized_bytes: "{\"references\":[]}",
        sha256: HASH,
      },
    },
    candidates: [candidate()],
    job_attempts: [candidateJob()],
    screen_receipts: [],
    tournament_receipts: [],
    amendments: [],
    selected_candidate_id: null,
    dossier: null,
    decision_receipt: null,
    attachments: [],
  }
}

export function candidate() {
  return {
    candidate_kind: "STRATEGY",
    candidate_id: "direct-01",
    strategy_id: "direct-proof",
    strategy_ordinal: 1,
    created_at_revision: 0,
    child_run_id: "campaign-1::direct-01",
    child_state_revision: 2,
    artifact: artifact(),
    parent_candidate_ids: [],
    attachments: [],
  }
}

export function artifact() {
  return {
    child_run_id: "campaign-1::direct-01",
    child_state_revision: 2,
    artifact_version: 1,
    media_type: "text/markdown",
    sha256: HASH,
  }
}

export function candidateJob() {
  return {
    job_id: "job-discovery-direct-01",
    target: { kind: "CANDIDATE", candidate_id: "direct-01" },
    attempt_number: 1,
    prepared_at_revision: 1,
    phase_revision: 2,
    idempotency_key: HASH,
    role: "candidate-generator",
    resolved_model: { providerID: "openai", modelID: "gpt-5" },
    profile_sha256: HASH,
    prompt_sha256: HASH,
    reference_sha256: HASH,
    input_sha256: HASH,
    child_title: `[openmath-research:${HASH}] discovery direct-01`,
    phase: "COMMITTED",
    child_session_id: "ses_candidate1",
    raw_output_sha256: HASH,
    receipt: { kind: "CANDIDATE_ARTIFACT", candidate_id: "direct-01", artifact_sha256: HASH },
  }
}
