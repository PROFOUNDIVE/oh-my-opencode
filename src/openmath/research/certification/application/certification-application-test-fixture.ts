import { sha256 } from "../../../workflow/stage-runner/sha256"
import { WorkflowStateV1Schema, type WorkflowStateV1 } from "../../../workflow/state"
import { buildCampaignSourceSnapshot } from "../../application/build-campaign-source-snapshot"
import {
  objectiveSnapshot,
  profileSnapshot,
  referenceSnapshot,
  rehashProfileSnapshot,
} from "../../application/application-test-fixture"
import {
  CandidateArtifactReferenceSchema,
  ResearchCampaignStateV1Schema,
  type ResearchCampaignStateV1,
} from "../../state"
import { stateFor } from "../../transitions/transition-test-fixture"
import { compareAndSwapCertificationGeneration, initializeCertificationGeneration } from "../storage"
import { blockCertificationJobOperation, persistCertificationJobLifecycle } from "../scheduler"

const CONTENT = "{\"theorem\":\"exact legacy bytes\"}"

export const applicationStorageWithoutCampaignGuard = {
  initialize_generation: async (input: Parameters<typeof initializeCertificationGeneration>[0]) => {
    const { campaign_guard: _campaignGuard, ...request } = input
    return initializeCertificationGeneration(request)
  },
  compare_and_swap_generation: async (input: Parameters<typeof compareAndSwapCertificationGeneration>[0]) => {
    const { campaign_guard: _campaignGuard, ...request } = input
    return compareAndSwapCertificationGeneration(request)
  },
  persist_job_lifecycle: async (input: Parameters<typeof persistCertificationJobLifecycle>[0]) => {
    const { campaign_guard: _campaignGuard, ...request } = input
    return persistCertificationJobLifecycle(request)
  },
  block_job_operation: async (input: Parameters<typeof blockCertificationJobOperation>[0]) => {
    const { campaign_guard: _campaignGuard, ...request } = input
    return blockCertificationJobOperation(request)
  },
} as const

export function certifiedPromotionFixture(content = CONTENT): Readonly<{
  readonly campaign: ResearchCampaignStateV1
  readonly child: WorkflowStateV1
}> {
  return promotionFixture(content, true)
}

export function legacyPromotionFixture(content = CONTENT): Readonly<{
  readonly campaign: ResearchCampaignStateV1
  readonly child: WorkflowStateV1
}> {
  return promotionFixture(content, false)
}

function promotionFixture(content: string, certificationEnabled: boolean): Readonly<{
  readonly campaign: ResearchCampaignStateV1
  readonly child: WorkflowStateV1
}> {
  const references = referenceSnapshot()
  const baseProfile = profileSnapshot(references)
  const certificationCore = {
    schema_version: 1 as const,
    extraction_role: certificationRole("extractor"),
    coverage_role: certificationRole("coverage-reviewer"),
    counterexample_role: certificationRole("attacker"),
    witness_role: certificationRole("witness-reviewer"),
    max_obligations: 64,
    max_coverage_rounds: 3,
    max_coverage_findings: 32,
    allowed_attack_modes: ["EDGE_CASE", "FINITE_SEARCH", "ASSUMPTION_REMOVAL"] as const,
    max_attacks_per_obligation: 2,
    max_active_certification_jobs: 4,
  }
  const profile = rehashProfileSnapshot({
    ...baseProfile,
    survivor_limit: 2,
    screening_roles: baseProfile.screening_roles.map((role) => ({ ...role, id: "logical-soundness" })),
    ...(certificationEnabled ? { certification: {
      ...certificationCore,
      certification_profile_hash: sha256(JSON.stringify(certificationCore)),
    } } : {}),
  })
  const sourceSnapshot = buildCampaignSourceSnapshot({
    objective: objectiveSnapshot(),
    profile,
    references,
  })
  const baseCampaign = stateFor("PROMOTION", "READY")
  const selected = baseCampaign.candidates.find((candidate) => candidate.candidate_id === baseCampaign.selected_candidate_id)
  if (selected === undefined || selected.artifact === null || selected.child_state_revision === null) {
    throw new TypeError("Promotion fixture requires a selected artifact")
  }
  const artifactSha256 = sha256(content)
  const artifactReference = CandidateArtifactReferenceSchema.parse({
    child_run_id: selected.child_run_id,
    child_state_revision: selected.child_state_revision,
    artifact_version: selected.artifact.artifact_version,
    media_type: "application/vnd.openmath.legacy+json" as const,
    sha256: artifactSha256,
  })
  const campaign = ResearchCampaignStateV1Schema.parse({
    ...baseCampaign,
    source_snapshot: sourceSnapshot,
    candidates: baseCampaign.candidates.map((candidate) => candidate.candidate_id === selected.candidate_id
      ? { ...candidate, artifact: artifactReference }
      : candidate),
    screen_receipts: baseCampaign.screen_receipts.map((screen) => ({
      ...screen,
      ...(screen.candidate_id === selected.candidate_id ? { artifact: artifactReference } : {}),
      profile_sha256: sourceSnapshot.profile.sha256,
      reference_sha256: sourceSnapshot.references.sha256,
    })),
    tournament_receipts: baseCampaign.tournament_receipts.map((receipt) => ({
      ...receipt,
      profile_sha256: sourceSnapshot.profile.sha256,
      reference_sha256: sourceSnapshot.references.sha256,
    })),
    job_attempts: baseCampaign.job_attempts.map((job) => ({
      ...updateSelectedJob(job, selected.candidate_id, artifactReference),
      profile_sha256: sourceSnapshot.profile.sha256,
      reference_sha256: sourceSnapshot.references.sha256,
    })),
  })
  const child = WorkflowStateV1Schema.parse({
    schema_version: 1,
    run_id: selected.child_run_id,
    state_revision: selected.child_state_revision,
    parent_session_id: campaign.parent_session_id,
    status: "PASSED",
    next_stage: null,
    awaiting_reason: null,
    abort_requested: false,
    abort_reason: null,
    blocked_reason: null,
    intervention_satisfied: false,
    review_round: 1,
    completed_review_rounds: 1,
    consecutive_passes: 1,
    artifact_version: artifactReference.artifact_version,
    request_snapshot: objectiveSnapshot(),
    profile_snapshot: profile.candidate_workflow_profile,
    reference_snapshot: references,
    artifact: {
      version: artifactReference.artifact_version,
      media_type: artifactReference.media_type,
      content,
      sha256: artifactSha256,
    },
    latest_review: review(artifactSha256),
    review_history: [review(artifactSha256)],
    amendments: [],
    stage_history: [],
    dispatch_attempts: [],
    legacy_projection: { kind: "none" },
    legacy_source_hash: null,
  })
  return { campaign, child }
}

function updateSelectedJob(
  job: ResearchCampaignStateV1["job_attempts"][number],
  candidateId: string,
  artifact: ResearchCampaignStateV1["candidates"][number]["artifact"],
) {
  if (artifact === null || job.phase !== "COMMITTED" || job.target.kind !== "CANDIDATE" || job.target.candidate_id !== candidateId
    || job.receipt.kind !== "CANDIDATE_ARTIFACT") return job
  return {
    ...job,
    receipt: {
      ...job.receipt,
      artifact_sha256: artifact.sha256,
      ...(job.receipt.predecessor_artifact === undefined ? {} : { predecessor_artifact: artifact }),
      ...(job.receipt.refined_artifact === undefined ? {} : { refined_artifact: artifact }),
    },
  }
}

function certificationRole(agent: string) {
  return {
    agent,
    model: { providerID: "openai", modelID: "gpt-5" },
    prompt: { kind: "inline" as const, content: `${agent} prompt`, content_hash: sha256(`${agent} prompt`) },
  }
}

function review(artifactSha256: string) {
  return {
    round: 1,
    verdict: "PASS" as const,
    raw_report: "PASS",
    raw_report_sha256: sha256("PASS"),
    findings: [],
    checks_performed: ["proof"],
    session_id: "ses_review1",
    prompt_hash: "a".repeat(64),
    reference_hash: "a".repeat(64),
    artifact_input_hash: artifactSha256,
  }
}
