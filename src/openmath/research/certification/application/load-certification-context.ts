import { sha256 } from "../../../workflow/stage-runner/sha256"
import { readWorkflowState } from "../../../workflow/storage"
import { readResearchCampaignState } from "../../storage"
import type { ResearchCampaignStateV1 } from "../../state"
import { CertificationSelectedArtifactSchema } from "../state/identity"
import { CertificationSha256Schema } from "../state/literals"
import type { CertificationApplicationDependencies } from "./certification-application-dependencies"
import type { CertificationApplicationFailure, CertificationContext } from "./certification-application-types"
import { selectCertificationSource } from "./certification-selection"

export type CertificationContextLoadResult =
  | Readonly<{ readonly kind: "disabled"; readonly campaign: ResearchCampaignStateV1 }>
  | Readonly<{ readonly kind: "ok"; readonly context: CertificationContext }>
  | CertificationApplicationFailure

export async function loadCertificationContext(
  input: Readonly<{ readonly directory: string; readonly campaign_id: string }>,
  dependencies: CertificationApplicationDependencies = {},
  options: Readonly<{ readonly allow_aborted?: boolean }> = {},
): Promise<CertificationContextLoadResult> {
  const campaignRead = await (dependencies.read_campaign ?? readResearchCampaignState)(input.directory, input.campaign_id)
  if (campaignRead.kind === "error") return campaignRead.error_code === "CAMPAIGN_NOT_FOUND"
    ? failure("CAMPAIGN_NOT_ELIGIBLE", campaignRead.message)
    : failure("STORAGE_READ_FAILED", campaignRead.message)
  const selection = selectCertificationSource(campaignRead.state)
  if (selection.kind !== "enabled") return selection
  if (selection.campaign.status === "ABORTED" && options.allow_aborted !== true) {
    return failure("CAMPAIGN_ABORTED", "Certification campaign is aborted")
  }
  const childRead = await (dependencies.read_child ?? readWorkflowState)(input.directory, selection.candidate.child_run_id)
  if (childRead.kind === "error") return failure("CHILD_WORKFLOW_FAILED", childRead.message)
  const certification = selection.sources.profile.certification
  if (certification === undefined) return failure("PROFILE_HASH_MISMATCH", "Frozen certification profile is unavailable")
  const artifact = childRead.state.artifact
  const expectedArtifact = selection.candidate.artifact
  if (childRead.state.status !== "PASSED" || artifact === null
    || childRead.state.run_id !== selection.candidate.child_run_id
    || childRead.state.parent_session_id !== selection.campaign.parent_session_id
    || childRead.state.state_revision !== selection.candidate.child_state_revision
    || JSON.stringify(childRead.state.request_snapshot) !== JSON.stringify(selection.sources.objective)
    || JSON.stringify(childRead.state.profile_snapshot) !== JSON.stringify(selection.sources.profile.candidate_workflow_profile)
    || JSON.stringify(childRead.state.reference_snapshot) !== JSON.stringify(selection.sources.references)
    || artifact.version !== expectedArtifact.artifact_version
    || artifact.media_type !== expectedArtifact.media_type
    || artifact.sha256 !== expectedArtifact.sha256
    || sha256(artifact.content) !== artifact.sha256) {
    return failure("STALE_ARTIFACT", "Selected child artifact identity or exact bytes are stale")
  }
  const stateIdentity = CertificationSelectedArtifactSchema.parse({
    candidate_id: selection.candidate.candidate_id,
    child_run_id: selection.candidate.child_run_id,
    child_state_revision: selection.candidate.child_state_revision,
    artifact_version: expectedArtifact.artifact_version,
    media_type: expectedArtifact.media_type,
    artifact_sha256: expectedArtifact.sha256,
  })
  const certificationProfileSha256 = CertificationSha256Schema.parse(certification.certification_profile_hash)
  return {
    kind: "ok",
    context: {
      campaign: selection.campaign,
      child: childRead.state,
      sources: selection.sources,
      state_identity: stateIdentity,
      storage_identity: {
        campaign_id: selection.campaign.campaign_id,
        selected_artifact: stateIdentity,
        certification_profile_sha256: certificationProfileSha256,
        initialized_from_campaign_revision: initializationRevision(selection.campaign),
      },
      profile: {
        certification_profile_sha256: certificationProfileSha256,
        max_obligations: certification.max_obligations,
        max_coverage_rounds: certification.max_coverage_rounds,
        max_coverage_findings: certification.max_coverage_findings,
        allowed_attack_modes: certification.allowed_attack_modes,
        max_attacks_per_obligation: certification.max_attacks_per_obligation,
        max_active_certification_jobs: certification.max_active_certification_jobs,
      },
    },
  }
}

function initializationRevision(campaign: ResearchCampaignStateV1): number {
  if (campaign.dossier !== null) return campaign.dossier.created_at_revision - 2
  const preAbortRevision = campaign.status === "ABORTED" ? campaign.state_revision - 1 : campaign.state_revision
  return campaign.attachments.some((attachment) => attachment.kind === "research-certification")
    ? preAbortRevision - 1
    : preAbortRevision
}

function failure(
  errorCode: CertificationApplicationFailure["error_code"],
  message: string,
): CertificationApplicationFailure {
  return { kind: "error", error_code: errorCode, message }
}
