import { compareAndSwapResearchCampaignState, readResearchCampaignState } from "../../storage"
import { reduceCampaignTransition } from "../../transitions"
import { buildCertificationAttachmentReference } from "../state/attachment-reference"
import { readCertificationAttachment, readCertificationGeneration } from "../storage"
import type { CertificationApplicationDependencies } from "./certification-application-dependencies"
import type { CertificationApplicationFailure, CertificationContext, CertificationStateResult } from "./certification-application-types"
import { loadCertificationContext } from "./load-certification-context"

export async function publishCompletedCertification(
  directory: string,
  context: CertificationContext,
  dependencies: CertificationApplicationDependencies,
): Promise<CertificationStateResult> {
  const refreshed = await loadCertificationContext({ directory, campaign_id: context.campaign.campaign_id }, dependencies)
  if (refreshed.kind === "disabled") return failure("CAMPAIGN_NOT_ELIGIBLE", "Certification is not enabled")
  if (refreshed.kind === "error") return refreshed
  context = refreshed.context
  const generation = await (dependencies.read_generation ?? readCertificationGeneration)({ directory, ...context.storage_identity })
  if (generation.kind !== "ok") return failure("STORAGE_READ_FAILED", "Completed certification is unreadable")
  if (generation.state.status !== "COMPLETE") return { kind: "ok", state: generation.state }
  const campaign = await (dependencies.read_campaign ?? readResearchCampaignState)(directory, context.campaign.campaign_id)
  if (campaign.kind === "error") return failure("STORAGE_READ_FAILED", campaign.message)
  if (campaign.state.status !== "READY" || campaign.state.phase !== "PROMOTION") {
    return failure("CAMPAIGN_ABORTED", "Completed certification cannot be published after campaign termination")
  }
  const attachment = buildCertificationAttachmentReference({
    generation_id: generation.index.generation_id,
    certification_revision: generation.state.certification_revision,
    content_sha256: generation.content_sha256,
  })
  const existing = campaign.state.attachments.find((candidate) => candidate.kind === "research-certification")
  if (existing !== undefined) {
    return JSON.stringify(existing) === JSON.stringify(attachment)
      ? { kind: "ok", state: generation.state }
      : failure("VALIDATION_ERROR", "Published certification attachment conflicts with completed sidecar")
  }
  const verified = await (dependencies.read_attachment ?? readCertificationAttachment)({
    directory,
    campaign_id: context.storage_identity.campaign_id,
    generation_id: generation.index.generation_id,
    selected_artifact: context.storage_identity.selected_artifact,
    certification_profile_sha256: context.storage_identity.certification_profile_sha256,
    initialized_from_campaign_revision: context.storage_identity.initialized_from_campaign_revision,
    certification_revision: generation.state.certification_revision,
    expected_content_sha256: generation.content_sha256,
    storage_ref: attachment.storage_ref,
  })
  if (verified.kind === "error") return failure("STORAGE_READ_FAILED", verified.message)
  const transition = reduceCampaignTransition(campaign.state, {
    type: "PUBLISH_CERTIFICATION_ATTACHMENT",
    selected_artifact: context.storage_identity.selected_artifact,
    certification_profile_sha256: context.storage_identity.certification_profile_sha256,
    generation_id: generation.index.generation_id,
    certification_revision: generation.state.certification_revision,
    attachment,
  })
  if (!transition.ok) return failure(transition.error_code, transition.message)
  const published = await (dependencies.compare_and_swap_campaign ?? compareAndSwapResearchCampaignState)({
    directory,
    campaign_id: campaign.state.campaign_id,
    expected_state_revision: campaign.state.state_revision,
    next_state: transition.state,
  })
  return published.kind === "ok"
    ? { kind: "ok", state: generation.state }
    : failure(published.error_code, published.message)
}

function failure(errorCode: CertificationApplicationFailure["error_code"], message: string): CertificationApplicationFailure {
  return { kind: "error", error_code: errorCode, message }
}
