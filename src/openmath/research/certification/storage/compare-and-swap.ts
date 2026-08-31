import { nodeStorageRuntime } from "../../../workflow/storage/node-storage-runtime"
import type { StorageRuntime } from "../../../workflow/storage/storage-runtime-contract"
import { getResearchCampaignDirectory } from "../../storage/campaign-directory-hash"
import { rethrowAfterResearchCampaignLockCleanup } from "../../storage/lock-cleanup-error"
import { acquireResearchCampaignWriteLock, releaseResearchCampaignWriteLock } from "../../storage/write-lock"
import { ResearchCertificationStateV1Schema, type ResearchCertificationStateV1 } from "../state/schema"
import { writeImmutableCertificationRevision } from "./publication-writers"
import { readCertificationGeneration } from "./reader"
import { serializeCertificationRevision } from "./serialization"
import { certificationStateMatchesIdentity, certificationStatesShareIdentity } from "./state-identity"
import { CertificationStorageIdentitySchema, type CertificationStorageIdentityInput } from "./storage-identity"
import type { CertificationMutationResult, CertificationMutationResultWithCleanup } from "./storage-results"
import { validateCertificationCampaignGuard, type CertificationCampaignGuard } from "./campaign-guard"

const CAS_LOCK_TIMEOUT_MS = 5_000

export async function compareAndSwapCertificationGeneration(
  request: {
    readonly directory: string
    readonly identity: CertificationStorageIdentityInput
    readonly expected_certification_revision: number
    readonly next_state: ResearchCertificationStateV1
    readonly campaign_guard?: CertificationCampaignGuard
  },
  runtime: StorageRuntime = nodeStorageRuntime,
): Promise<CertificationMutationResultWithCleanup> {
  const identity = CertificationStorageIdentitySchema.safeParse(request.identity)
  if (!identity.success) return { kind: "error", error_code: "STORAGE_WRITE_FAILED", message: "Certification CAS identity is invalid" }
  const campaignDirectory = getResearchCampaignDirectory(request.directory, identity.data.campaign_id)
  const lock = await acquireResearchCampaignWriteLock({ campaign_directory: campaignDirectory, timeout_ms: CAS_LOCK_TIMEOUT_MS }, runtime)
  if (lock.kind === "error") return lock
  let outcome: CertificationMutationResult
  try {
    outcome = await commitWhileLocked(request, identity.data, runtime)
  } catch (error) {
    return rethrowAfterResearchCampaignLockCleanup(error, () =>
      releaseResearchCampaignWriteLock({ campaign_directory: campaignDirectory, token: lock.token }, runtime))
  }
  const released = await releaseResearchCampaignWriteLock({ campaign_directory: campaignDirectory, token: lock.token }, runtime)
  if (released.kind === "error" && outcome.kind === "error") return { ...outcome, cleanup_failure: released }
  return released.kind === "error" ? released : outcome
}

async function commitWhileLocked(
  request: Parameters<typeof compareAndSwapCertificationGeneration>[0],
  identity: ReturnType<typeof CertificationStorageIdentitySchema.parse>,
  runtime: StorageRuntime,
): Promise<CertificationMutationResult> {
  if (request.campaign_guard !== undefined) {
    const guarded = await validateCertificationCampaignGuard(request.directory, identity.campaign_id, request.campaign_guard, runtime)
    if (guarded.kind === "error") return guarded
  }
  const current = await readCertificationGeneration({ directory: request.directory, ...identity }, runtime)
  if (current.kind === "not_started") return { kind: "error", error_code: "CERTIFICATION_NOT_FOUND", message: "Certification generation is not initialized" }
  if (current.kind === "error") return current
  if (current.state.certification_revision !== request.expected_certification_revision) {
    return {
      kind: "error",
      error_code: "STALE_CERTIFICATION_REVISION",
      current_certification_revision: current.state.certification_revision,
      message: `Expected certification revision ${request.expected_certification_revision}, found ${current.state.certification_revision}`,
    }
  }
  const revision = current.state.certification_revision + 1
  const next = ResearchCertificationStateV1Schema.safeParse({ ...request.next_state, certification_revision: revision })
  if (!next.success || !certificationStateMatchesIdentity(next.data, identity)
    || !certificationStatesShareIdentity(current.state, next.data)) {
    return { kind: "error", error_code: "STORAGE_WRITE_FAILED", message: "Resulting certification state identity is invalid" }
  }
  const written = await writeImmutableCertificationRevision({
    directory: request.directory,
    campaign_id: identity.campaign_id,
    generation_id: current.state.generation_id,
    revision,
    serialized_bytes: serializeCertificationRevision(next.data),
  }, runtime)
  return written.kind === "ok" ? { kind: "ok", state: next.data } : written
}
