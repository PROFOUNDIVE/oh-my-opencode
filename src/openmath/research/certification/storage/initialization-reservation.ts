import { nodeStorageRuntime } from "../../../workflow/storage/node-storage-runtime"
import type { StorageRuntime } from "../../../workflow/storage/storage-runtime-contract"
import { getResearchCampaignDirectory } from "../../storage/campaign-directory-hash"
import { rethrowAfterResearchCampaignLockCleanup } from "../../storage/lock-cleanup-error"
import { acquireResearchCampaignWriteLock, releaseResearchCampaignWriteLock } from "../../storage/write-lock"
import { ResearchCertificationStateV1Schema, type ResearchCertificationStateV1 } from "../state/schema"
import { CampaignRevisionSchema } from "../../state/literals"
import { buildCertificationGenerationIndex } from "./generation-index"
import { getCertificationDirectory, getCertificationGenerationDirectory } from "./paths"
import { writeImmutableCertificationGenerationIndex, writeImmutableCertificationRevision } from "./publication-writers"
import { readCertificationGeneration } from "./reader"
import { serializeCertificationGenerationIndex, serializeCertificationRevision } from "./serialization"
import type { CertificationMutationResult, CertificationMutationResultWithCleanup } from "./storage-results"
import { validateCertificationCampaignGuard, type CertificationCampaignGuard } from "./campaign-guard"

const INITIALIZATION_LOCK_TIMEOUT_MS = 30_000

export async function initializeCertificationGeneration(
  request: {
    readonly directory: string
    readonly state: ResearchCertificationStateV1
    readonly initialized_from_campaign_revision: number
    readonly campaign_guard?: CertificationCampaignGuard
  },
  runtime: StorageRuntime = nodeStorageRuntime,
): Promise<CertificationMutationResultWithCleanup> {
  const state = ResearchCertificationStateV1Schema.safeParse(request.state)
  const campaignRevision = CampaignRevisionSchema.safeParse(request.initialized_from_campaign_revision)
  if (!state.success || state.data.certification_revision !== 0 || !campaignRevision.success) {
    return { kind: "error", error_code: "STORAGE_WRITE_FAILED", message: "Initial certification state must be strict revision zero" }
  }
  const campaignDirectory = getResearchCampaignDirectory(request.directory, state.data.campaign_id)
  try {
    await runtime.mkdir(campaignDirectory)
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return { kind: "error", error_code: "STORAGE_WRITE_FAILED", message: "Unable to create certification campaign directory" }
  }
  const lock = await acquireResearchCampaignWriteLock({ campaign_directory: campaignDirectory, timeout_ms: INITIALIZATION_LOCK_TIMEOUT_MS }, runtime)
  if (lock.kind === "error") return lock
  let outcome: CertificationMutationResult
  try {
    outcome = await initializeWhileLocked({
      directory: request.directory,
      state: state.data,
      campaign_revision: campaignRevision.data,
      campaign_guard: request.campaign_guard,
    }, runtime)
  } catch (error) {
    return rethrowAfterResearchCampaignLockCleanup(error, () =>
      releaseResearchCampaignWriteLock({ campaign_directory: campaignDirectory, token: lock.token }, runtime))
  }
  const released = await releaseResearchCampaignWriteLock({ campaign_directory: campaignDirectory, token: lock.token }, runtime)
  if (released.kind === "error" && outcome.kind === "error") return { ...outcome, cleanup_failure: released }
  return released.kind === "error" ? released : outcome
}

async function initializeWhileLocked(
  request: {
    readonly directory: string
    readonly state: ResearchCertificationStateV1
    readonly campaign_revision: number
    readonly campaign_guard?: CertificationCampaignGuard
  },
  runtime: StorageRuntime,
): Promise<CertificationMutationResult> {
  const { directory, state } = request
  if (request.campaign_guard !== undefined) {
    const guarded = await validateCertificationCampaignGuard(directory, state.campaign_id, request.campaign_guard, runtime)
    if (guarded.kind === "error") return guarded
  }
  const identity = {
    campaign_id: state.campaign_id,
    selected_artifact: state.selected_artifact,
    certification_profile_sha256: state.certification_profile_sha256,
    initialized_from_campaign_revision: request.campaign_revision,
  }
  const existing = await readCertificationGeneration({ directory, ...identity }, runtime)
  if (existing.kind === "ok") return { kind: "error", error_code: "CERTIFICATION_ALREADY_EXISTS", message: "Certification generation is already initialized" }
  if (existing.kind === "error") return existing
  const generationDirectory = getCertificationGenerationDirectory(directory, state.campaign_id, state.generation_id)
  try {
    await runtime.mkdir(getCertificationDirectory(directory, state.campaign_id))
    await runtime.mkdir(generationDirectory)
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return { kind: "error", error_code: "STORAGE_WRITE_FAILED", message: "Unable to create certification generation directory" }
  }
  const revision = await writeImmutableCertificationRevision({
    directory,
    campaign_id: state.campaign_id,
    generation_id: state.generation_id,
    revision: 0,
    serialized_bytes: serializeCertificationRevision(state),
  }, runtime)
  if (revision.kind === "error") return revision
  const index = buildCertificationGenerationIndex(state, request.campaign_revision)
  const indexed = await writeImmutableCertificationGenerationIndex({
    directory,
    campaign_id: state.campaign_id,
    serialized_bytes: serializeCertificationGenerationIndex(index),
  }, runtime)
  return indexed.kind === "ok" ? { kind: "ok", state } : indexed
}
