import { loadCertificationContext } from "../certification/application/load-certification-context"
import { readCertificationAttachment, readCertificationGeneration } from "../certification/storage"
import type { ResearchCertificationStateV1 } from "../certification/state/schema"

export type PromotionCertificationEvidenceReadResult =
  | Readonly<{
      readonly kind: "ok"
      readonly state: ResearchCertificationStateV1
      readonly content_sha256: string
      readonly observed_selected_artifact: ResearchCertificationStateV1["selected_artifact"]
      readonly artifact_content_sha256: string
    }>
  | Readonly<{ readonly kind: "error"; readonly message: string }>

export async function readPromotionCertificationEvidence(input: Readonly<{
  readonly directory: string
  readonly campaign_id: string
  readonly expected_state_revision: number
}>): Promise<PromotionCertificationEvidenceReadResult> {
  const loaded = await loadCertificationContext(input)
  if (loaded.kind !== "ok") {
    return { kind: "error", message: loaded.kind === "disabled" ? "Certification is not enabled" : loaded.message }
  }
  if (loaded.context.campaign.state_revision !== input.expected_state_revision) {
    return { kind: "error", message: "Campaign revision changed before V2 dossier construction" }
  }
  const storageIdentity = loaded.context.storage_identity
  const generation = await readCertificationGeneration({ directory: input.directory, ...storageIdentity })
  if (generation.kind !== "ok" || generation.state.status !== "COMPLETE") {
    return { kind: "error", message: "Complete certification sidecar is unavailable" }
  }
  const attachment = loaded.context.campaign.attachments.find((candidate) => candidate.kind === "research-certification")
  if (attachment === undefined) return { kind: "error", message: "Certification attachment is unavailable" }
  const verified = await readCertificationAttachment({
    directory: input.directory,
    campaign_id: storageIdentity.campaign_id,
    generation_id: generation.index.generation_id,
    selected_artifact: storageIdentity.selected_artifact,
    certification_profile_sha256: storageIdentity.certification_profile_sha256,
    initialized_from_campaign_revision: storageIdentity.initialized_from_campaign_revision,
    certification_revision: generation.state.certification_revision,
    expected_content_sha256: attachment.content_sha256,
    storage_ref: attachment.storage_ref,
  })
  const childArtifact = loaded.context.child.artifact
  if (verified.kind !== "ok") return { kind: "error", message: verified.message }
  if (childArtifact === null) return { kind: "error", message: "Selected artifact bytes are unavailable" }
  return {
    kind: "ok",
    state: verified.state,
    content_sha256: verified.content_sha256,
    observed_selected_artifact: loaded.context.state_identity,
    artifact_content_sha256: childArtifact.sha256,
  }
}
