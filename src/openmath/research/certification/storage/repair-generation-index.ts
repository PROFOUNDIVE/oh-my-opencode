import { nodeStorageRuntime } from "../../../workflow/storage/node-storage-runtime"
import type { StorageRuntime } from "../../../workflow/storage/storage-runtime-contract"
import { getResearchCampaignDirectory } from "../../storage/campaign-directory-hash"
import { rethrowAfterResearchCampaignLockCleanup } from "../../storage/lock-cleanup-error"
import { acquireResearchCampaignWriteLock, releaseResearchCampaignWriteLock } from "../../storage/write-lock"
import { deriveCertificationIdentity } from "../state/identity"
import { buildCertificationGenerationIndex } from "./generation-index"
import { readCertificationGenerationIndex } from "./index-reader"
import { getCertificationGenerationDirectory } from "./paths"
import { writeImmutableCertificationGenerationIndex } from "./publication-writers"
import { readHighestCertificationRevision } from "./revision-reader"
import { serializeCertificationGenerationIndex } from "./serialization"
import { certificationStateMatchesIdentity } from "./state-identity"
import { CertificationStorageIdentitySchema, type CertificationStorageIdentityInput } from "./storage-identity"
import type { CertificationMutationResult, CertificationMutationResultWithCleanup } from "./storage-results"
import { validateCertificationCampaignGuard, type CertificationCampaignGuard } from "./campaign-guard"

const REPAIR_LOCK_TIMEOUT_MS = 5_000

export async function repairCertificationGenerationIndex(
  request: { readonly directory: string; readonly campaign_guard?: CertificationCampaignGuard } & CertificationStorageIdentityInput,
  runtime: StorageRuntime = nodeStorageRuntime,
): Promise<CertificationMutationResultWithCleanup> {
  const identity = CertificationStorageIdentitySchema.safeParse({
    campaign_id: request.campaign_id,
    selected_artifact: request.selected_artifact,
    certification_profile_sha256: request.certification_profile_sha256,
    initialized_from_campaign_revision: request.initialized_from_campaign_revision,
  })
  if (!identity.success) return { kind: "error", error_code: "STORAGE_READ_FAILED", message: "Certification repair identity is invalid" }
  const campaignDirectory = getResearchCampaignDirectory(request.directory, identity.data.campaign_id)
  const lock = await acquireResearchCampaignWriteLock({ campaign_directory: campaignDirectory, timeout_ms: REPAIR_LOCK_TIMEOUT_MS }, runtime)
  if (lock.kind === "error") return lock
  let outcome: CertificationMutationResult
  try {
    outcome = await repairWhileLocked(request.directory, identity.data, request.campaign_guard, runtime)
  } catch (error) {
    return rethrowAfterResearchCampaignLockCleanup(error, () =>
      releaseResearchCampaignWriteLock({ campaign_directory: campaignDirectory, token: lock.token }, runtime))
  }
  const released = await releaseResearchCampaignWriteLock({ campaign_directory: campaignDirectory, token: lock.token }, runtime)
  if (released.kind === "error" && outcome.kind === "error") return { ...outcome, cleanup_failure: released }
  return released.kind === "error" ? released : outcome
}

async function repairWhileLocked(
  directory: string,
  identity: ReturnType<typeof CertificationStorageIdentitySchema.parse>,
  campaignGuard: CertificationCampaignGuard | undefined,
  runtime: StorageRuntime,
): Promise<CertificationMutationResult> {
  if (campaignGuard !== undefined) {
    const guarded = await validateCertificationCampaignGuard(directory, identity.campaign_id, campaignGuard, runtime)
    if (guarded.kind === "error") return guarded
  }
  const index = await readCertificationGenerationIndex(directory, identity, runtime)
  if (index.kind === "ok") return { kind: "error", error_code: "CERTIFICATION_ALREADY_EXISTS", message: "Certification generation index already exists" }
  if (index.kind === "error") return index
  const expected = deriveCertificationIdentity({
    campaign_id: identity.campaign_id,
    selected_artifact_sha256: identity.selected_artifact.artifact_sha256,
    certification_profile_sha256: identity.certification_profile_sha256,
  })
  const revision = await readHighestCertificationRevision(
    getCertificationGenerationDirectory(directory, identity.campaign_id, expected.generation_id),
    runtime,
  )
  if (revision.kind === "missing") return { kind: "error", error_code: "CERTIFICATION_NOT_FOUND", message: "No certification revision orphan exists" }
  if (revision.kind === "error") return revision
  if (revision.state.certification_revision !== 0 || !certificationStateMatchesIdentity(revision.state, identity)) {
    return { kind: "error", error_code: "STORAGE_READ_FAILED", message: "Certification revision orphan identity is invalid" }
  }
  const generationIndex = buildCertificationGenerationIndex(revision.state, identity.initialized_from_campaign_revision)
  const written = await writeImmutableCertificationGenerationIndex({
    directory,
    campaign_id: identity.campaign_id,
    serialized_bytes: serializeCertificationGenerationIndex(generationIndex),
  }, runtime)
  return written.kind === "ok" ? { kind: "ok", state: revision.state } : written
}
