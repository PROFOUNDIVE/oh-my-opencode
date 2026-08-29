import { artifact, candidateJob, createResearchCampaignStateFixture } from "./test-fixture"

const HASH = "a".repeat(64)

export function campaignWithReceipts() {
  const direct = createResearchCampaignStateFixture().candidates[0]
  const construction = {
    ...direct,
    candidate_id: "construction-01",
    strategy_id: "construction",
    child_run_id: "campaign-1::construction-01",
    artifact: artifactFor("construction-01"),
  }
  return {
    ...createResearchCampaignStateFixture(),
    phase: "DEEP_REFINEMENT",
    source_snapshot: {
      ...createResearchCampaignStateFixture().source_snapshot,
      profile: {
        ...createResearchCampaignStateFixture().source_snapshot.profile,
        serialized_bytes: JSON.stringify({
          survivor_limit: 2,
          screening_roles: [{ id: "logical-soundness" }],
        }),
      },
    },
    candidates: [direct, construction],
    job_attempts: [
      candidateJob(),
      committedScreenJob("direct-01"),
      committedScreenJob("construction-01"),
      committedTournamentJob(),
      committedRefinementJob(),
    ],
    screen_receipts: [screen("direct-01", 4), screen("construction-01", 5)],
    tournament_receipts: [tournament()],
    selected_candidate_id: "direct-01",
  }
}

export function screen(candidateId: string, campaignRevision: number) {
  return {
    screen_id: `screen-${candidateId}`,
    job_id: `job-screen-${candidateId}`,
    campaign_revision: campaignRevision,
    candidate_id: candidateId,
    artifact: artifactFor(candidateId),
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

export function tournament() {
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

function artifactFor(candidateId: string) {
  return { ...artifact(), child_run_id: `campaign-1::${candidateId}` }
}

function committedScreenJob(candidateId: string) {
  return {
    ...candidateJob(),
    job_id: `job-screen-${candidateId}`,
    target: { kind: "SCREEN", screen_id: `screen-${candidateId}`, candidate_id: candidateId },
    phase_revision: candidateId === "direct-01" ? 4 : 5,
    child_session_id: `ses_screen${candidateId.replaceAll("-", "")}`,
    resolved_model: { providerID: "anthropic", modelID: "claude-opus" },
    receipt: { kind: "SCREEN", screen_id: `screen-${candidateId}` },
  }
}

function committedTournamentJob() {
  return {
    ...candidateJob(),
    job_id: "job-tournament-initial",
    target: { kind: "TOURNAMENT", tournament_id: "tournament-initial" },
    phase_revision: 6,
    child_session_id: "ses_tournament1",
    receipt: { kind: "TOURNAMENT", tournament_id: "tournament-initial", result: tournament().result },
  }
}

function committedRefinementJob() {
  return {
    ...candidateJob(),
    job_id: "job-refinement-direct-01",
    target: { kind: "CANDIDATE", candidate_id: "direct-01" },
    prepared_at_revision: 7,
    phase_revision: 8,
    child_session_id: "ses_review1",
    receipt: {
      kind: "CANDIDATE_ARTIFACT",
      candidate_id: "direct-01",
      artifact_sha256: HASH,
      predecessor_artifact: artifactFor("direct-01"),
      refined_artifact: artifactFor("direct-01"),
    },
  }
}
