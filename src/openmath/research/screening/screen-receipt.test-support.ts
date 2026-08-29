import { sha256 } from "../../workflow/stage-runner/sha256"
import { ArtifactDtoSchema } from "../../workflow/state"
import {
  CampaignHashSchema,
  CampaignJobIdSchema,
  CampaignSessionIdSchema,
  CandidateArtifactReferenceSchema,
  CandidateIdSchema,
  ResolvedResearchModelSchema,
  ScreenIdSchema,
} from "../state"

export function screenReceiptInput(rawOutput: string, artifactContent = "Proof candidate") {
  const artifactHash = CampaignHashSchema.parse(sha256(artifactContent))
  return {
    screen_id: ScreenIdSchema.parse("screen-direct-01"),
    job_id: CampaignJobIdSchema.parse("job-screen-direct-01"),
    campaign_revision: 12,
    candidate_id: CandidateIdSchema.parse("direct-01"),
    target_artifact: ArtifactDtoSchema.parse({
      version: 3,
      media_type: "text/markdown" as const,
      content: artifactContent,
      sha256: artifactHash,
    }),
    artifact: CandidateArtifactReferenceSchema.parse({
      child_run_id: "campaign-1::direct-01",
      child_state_revision: 7,
      artifact_version: 3,
      media_type: "text/markdown",
      sha256: artifactHash,
    }),
    screen_role: "logical-soundness",
    reviewer_session_id: CampaignSessionIdSchema.parse("ses_screenReviewer1"),
    resolved_model: ResolvedResearchModelSchema.parse({ providerID: "anthropic", modelID: "claude-opus" }),
    profile_sha256: CampaignHashSchema.parse("a".repeat(64)),
    prompt_sha256: CampaignHashSchema.parse("b".repeat(64)),
    reference_sha256: CampaignHashSchema.parse("c".repeat(64)),
    raw_output: rawOutput,
  }
}
