import { sha256 } from "../../workflow/stage-runner/sha256"
import { WorkflowStateV1Schema } from "../../workflow/state"
import { certifiedPromotionFixture } from "../certification/application/certification-application-test-fixture"
import { buildCertificationAttachmentReference } from "../certification/state/attachment-reference"
import { completeCertificationState } from "../certification/state/complete-state-test-fixture"
import { deriveCertificationIdentity } from "../certification/state/identity"
import { hashResearchCertificationState, ResearchCertificationStateV1Schema } from "../certification/state/schema"
import { completeCertificationStateWithWitness } from "../certification/state/witness-state-test-fixture"
import { parseFrozenCandidateSources } from "../candidates/frozen-candidate-sources"
import { CandidateArtifactReferenceSchema, ResearchCampaignStateV1Schema } from "../state"
import { reduceCampaignTransition } from "../transitions"

const ARTIFACT_CONTENT = "Theorem\nLemma\nClaim\nDefinition\nImported\nComputation"

export function promotionDossierV2Inputs(witnessOutcome?: "CONFIRMED" | "REJECTED" | "INCONCLUSIVE") {
  const fixture = certifiedPromotionFixture(ARTIFACT_CONTENT)
  const renamedCampaign = ResearchCampaignStateV1Schema.parse(JSON.parse(
    JSON.stringify(fixture.campaign)
      .replaceAll("campaign-1", "campaign-a")
      .replaceAll("direct-01", "candidate-01"),
  ))
  const desiredArtifact = CandidateArtifactReferenceSchema.parse({
    child_run_id: "campaign-a::candidate-01",
    child_state_revision: 7,
    artifact_version: 2,
    media_type: "text/markdown" as const,
    sha256: sha256(ARTIFACT_CONTENT),
  })
  const selectedId = "candidate-01"
  const campaign = ResearchCampaignStateV1Schema.parse({
    ...renamedCampaign,
    candidates: renamedCampaign.candidates.map((candidate) => candidate.candidate_id === selectedId
      ? { ...candidate, child_state_revision: 7, artifact: desiredArtifact }
      : candidate),
    screen_receipts: renamedCampaign.screen_receipts.map((screen) => screen.candidate_id === selectedId
      ? { ...screen, artifact: desiredArtifact }
      : screen),
    job_attempts: renamedCampaign.job_attempts.map((job) => rebindCampaignJobArtifact(job, selectedId, desiredArtifact)),
  })
  const frozen = parseFrozenCandidateSources(campaign)
  if (!frozen.ok || frozen.sources.profile.certification === undefined) throw new TypeError("Missing certification profile")
  const certification = rebindCertification(campaign, frozen.sources.profile.certification.certification_profile_hash, witnessOutcome)
  if (certification.status !== "COMPLETE") throw new TypeError("Expected complete certification fixture")
  const certificationContentSha256 = hashResearchCertificationState(certification)
  const attachment = buildCertificationAttachmentReference({
    generation_id: certification.generation_id,
    certification_revision: certification.certification_revision,
    content_sha256: certificationContentSha256,
  })
  const published = reduceCampaignTransition(campaign, {
    type: "PUBLISH_CERTIFICATION_ATTACHMENT",
    selected_artifact: certification.selected_artifact,
    certification_profile_sha256: certification.certification_profile_sha256,
    generation_id: certification.generation_id,
    certification_revision: certification.certification_revision,
    attachment,
  })
  if (!published.ok) throw new TypeError(published.message)
  const child = WorkflowStateV1Schema.parse({
    ...JSON.parse(JSON.stringify(fixture.child).replaceAll("campaign-1", "campaign-a").replaceAll("direct-01", "candidate-01")),
    state_revision: 7,
    artifact_version: 2,
    artifact: { version: 2, media_type: "text/markdown", content: ARTIFACT_CONTENT, sha256: desiredArtifact.sha256 },
    dispatch_attempts: [committedReviewAttempt(fixture.child, frozen.sources.profile.candidate_workflow_profile_hash, desiredArtifact.sha256)],
  })
  return { campaign: published.state, child, certification, certification_content_sha256: certificationContentSha256 }
}

function rebindCampaignJobArtifact(
  job: ReturnType<typeof ResearchCampaignStateV1Schema.parse>["job_attempts"][number],
  selectedId: string,
  artifact: ReturnType<typeof ResearchCampaignStateV1Schema.parse>["candidates"][number]["artifact"],
) {
  if (artifact === null || job.phase !== "COMMITTED" || job.target.kind !== "CANDIDATE"
    || job.target.candidate_id !== selectedId || job.receipt.kind !== "CANDIDATE_ARTIFACT") return job
  return {
    ...job,
    raw_output_sha256: sha256("PASS"),
    receipt: {
      ...job.receipt,
      artifact_sha256: artifact.sha256,
      ...(job.receipt.predecessor_artifact === undefined ? {} : { predecessor_artifact: artifact }),
      ...(job.receipt.refined_artifact === undefined ? {} : { refined_artifact: artifact }),
    },
  }
}

function rebindCertification(
  campaign: ReturnType<typeof ResearchCampaignStateV1Schema.parse>,
  profileSha256: string,
  witnessOutcome?: "CONFIRMED" | "REJECTED" | "INCONCLUSIVE",
) {
  const base = witnessOutcome === undefined ? completeCertificationState() : completeCertificationStateWithWitness(witnessOutcome)
  const identity = deriveCertificationIdentity({
    campaign_id: campaign.campaign_id,
    selected_artifact_sha256: base.selected_artifact.artifact_sha256,
    certification_profile_sha256: profileSha256,
  })
  const jobs = base.job_attempts.map((job) => ({
    ...job,
    ...identity,
    campaign_id: campaign.campaign_id,
    certification_profile_sha256: profileSha256,
    reference_sha256: campaign.source_snapshot.references.sha256,
  }))
  const summary = {
    ...base.summary,
    ...identity,
  }
  return ResearchCertificationStateV1Schema.parse({
    ...base,
    ...identity,
    campaign_id: campaign.campaign_id,
    objective_sha256: campaign.source_snapshot.objective.sha256,
    profile_sha256: campaign.source_snapshot.profile.sha256,
    reference_sha256: campaign.source_snapshot.references.sha256,
    certification_profile_sha256: profileSha256,
    job_attempts: jobs,
    evidence_receipts: base.evidence_receipts.map((receipt) => ({
      ...receipt,
      ...identity,
      campaign_id: campaign.campaign_id,
    })),
    summary,
    finalization: { ...base.finalization, summary_sha256: sha256(JSON.stringify(summary)) },
  })
}

function committedReviewAttempt(
  child: ReturnType<typeof certifiedPromotionFixture>["child"],
  profileHash: string,
  artifactSha256: string,
) {
  const review = child.latest_review
  if (review === null) throw new TypeError("Missing review fixture")
  return {
    phase: "COMMITTED",
    stage: "REVIEW",
    role: "reviewer",
    resolved_model: { providerID: "openai", modelID: "gpt-5" },
    review_round: 1,
    attempt_number: 1,
    state_revision: 7,
    idempotency_key: sha256("review-attempt"),
    profile_hash: profileHash,
    prompt_hash: review.prompt_hash,
    reference_hash: review.reference_hash,
    artifact_input_hash: artifactSha256,
    child_title: "promotion review",
    child_session_id: review.session_id,
    raw_output: review.raw_report,
    output_hash: sha256(review.raw_report),
    receipt: { kind: "REVIEW", review },
  }
}
