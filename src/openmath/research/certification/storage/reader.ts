import { nodeStorageRuntime } from "../../../workflow/storage/node-storage-runtime"
import type { StorageRuntime } from "../../../workflow/storage/storage-runtime-contract"
import { CampaignIdSchema } from "../../state/literals"
import { deriveCertificationIdentity } from "../state/identity"
import { CertificationGenerationIdSchema, CertificationRevisionSchema, CertificationSha256Schema } from "../state/literals"
import { readCertificationGenerationIndex } from "./index-reader"
import { getCertificationGenerationDirectory, getCertificationStorageRef } from "./paths"
import { readHighestCertificationRevision } from "./revision-reader"
import { certificationStateMatchesIdentity } from "./state-identity"
import { CertificationStorageIdentitySchema, type CertificationStorageIdentityInput } from "./storage-identity"
import type { CertificationAttachmentReadResult, CertificationReadResult } from "./storage-results"
import { hasUnindexedCertificationRevision } from "./unindexed-discovery"

export async function readCertificationGeneration(
  request: { readonly directory: string } & CertificationStorageIdentityInput,
  runtime: StorageRuntime = nodeStorageRuntime,
): Promise<CertificationReadResult> {
  const parsedIdentity = CertificationStorageIdentitySchema.safeParse({
    campaign_id: request.campaign_id,
    selected_artifact: request.selected_artifact,
    certification_profile_sha256: request.certification_profile_sha256,
    initialized_from_campaign_revision: request.initialized_from_campaign_revision,
  })
  if (!parsedIdentity.success) return { kind: "error", error_code: "STORAGE_READ_FAILED", reason: "INVALID_IDENTITY", message: "Certification storage identity is invalid" }
  const identity = parsedIdentity.data
  const index = await readCertificationGenerationIndex(request.directory, identity, runtime)
  const expected = deriveCertificationIdentity({
    campaign_id: identity.campaign_id,
    selected_artifact_sha256: identity.selected_artifact.artifact_sha256,
    certification_profile_sha256: identity.certification_profile_sha256,
  })
  const generationDirectory = getCertificationGenerationDirectory(request.directory, identity.campaign_id, expected.generation_id)
  if (index.kind === "missing") {
    const orphan = await hasUnindexedCertificationRevision(request.directory, identity.campaign_id, runtime)
    if (orphan === false) return { kind: "not_started" }
    return { kind: "error", error_code: "STORAGE_READ_FAILED", reason: "REVISION_WITHOUT_INDEX", message: "Certification revision exists without a generation index" }
  }
  if (index.kind === "error") return index
  const revision = await readHighestCertificationRevision(generationDirectory, runtime)
  if (revision.kind === "missing") return { kind: "error", error_code: "STORAGE_READ_FAILED", reason: "INDEX_WITHOUT_REVISION", message: "Certification generation index has no readable revision" }
  if (revision.kind === "error") return revision
  if (index.index.generation_id !== expected.generation_id || !certificationStateMatchesIdentity(revision.state, identity)) {
    return { kind: "error", error_code: "STORAGE_READ_FAILED", reason: "INVALID_IDENTITY", message: "Certification revision identity does not match its generation index" }
  }
  return {
    kind: "ok",
    state: revision.state,
    index: index.index,
    content_sha256: revision.content_sha256,
    index_content_sha256: index.content_sha256,
  }
}

export async function readCertificationAttachment(
  request: {
    readonly directory: string
    readonly campaign_id: string
    readonly generation_id: string
    readonly selected_artifact: CertificationStorageIdentityInput["selected_artifact"]
    readonly certification_profile_sha256: string
    readonly initialized_from_campaign_revision: number
    readonly certification_revision: number
    readonly expected_content_sha256: string
    readonly storage_ref: string
  },
  runtime: StorageRuntime = nodeStorageRuntime,
): Promise<CertificationAttachmentReadResult> {
  const parsed = CampaignIdSchema.safeParse(request.campaign_id)
  const generation = CertificationGenerationIdSchema.safeParse(request.generation_id)
  const revision = CertificationRevisionSchema.safeParse(request.certification_revision)
  const expectedHash = CertificationSha256Schema.safeParse(request.expected_content_sha256)
  if (!parsed.success || !generation.success || !revision.success || !expectedHash.success) {
    return { kind: "error", error_code: "STORAGE_READ_FAILED", message: "Certification attachment identity is invalid" }
  }
  if (request.storage_ref !== getCertificationStorageRef(generation.data, revision.data)) {
    return { kind: "error", error_code: "STORAGE_READ_FAILED", message: "Certification attachment storage reference is invalid" }
  }
  const generationRead = await readCertificationGeneration({
    directory: request.directory,
    campaign_id: parsed.data,
    selected_artifact: request.selected_artifact,
    certification_profile_sha256: request.certification_profile_sha256,
    initialized_from_campaign_revision: request.initialized_from_campaign_revision,
  }, runtime)
  if (generationRead.kind !== "ok" || generationRead.index.generation_id !== generation.data
    || generationRead.state.certification_revision !== revision.data) {
    return { kind: "error", error_code: "STORAGE_READ_FAILED", message: "Certification attachment revision identity is invalid" }
  }
  if (generationRead.content_sha256 !== expectedHash.data) return { kind: "error", error_code: "CONTENT_HASH_MISMATCH", message: "Certification attachment content hash mismatch" }
  return { kind: "ok", state: generationRead.state, content_sha256: generationRead.content_sha256 }
}
