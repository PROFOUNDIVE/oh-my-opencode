import { join } from "node:path"

import { nodeStorageRuntime } from "../../workflow/storage/node-storage-runtime"
import type { StorageRuntime } from "../../workflow/storage/storage-runtime-contract"
import { getFilesystemErrorCode } from "./filesystem-error-code"
import { inspectResearchCampaignOperationLock } from "./operation-lock-inspection"
import {
  parseResearchCampaignOperationId,
  serializeResearchCampaignOperationOwner,
} from "./operation-lock-record"
import type {
  ResearchCampaignOperationLockReleaseResult,
  ResearchCampaignOperationLockResult,
  ResearchCampaignOperationOwner,
  ResearchCampaignWriteLockReleaseResult,
} from "./storage-results"
import { acquireResearchCampaignWriteLock, releaseResearchCampaignWriteLock } from "./write-lock"
import { rethrowAfterResearchCampaignLockCleanup } from "./lock-cleanup-error"

export { readResearchCampaignOperationLock } from "./operation-lock-inspection"

const ATOMICITY_CODES = new Set(["ENOSYS", "ENOTSUP", "EOPNOTSUPP", "EINVAL", "EXDEV", "EPERM"])
const OPERATION_METADATA_LOCK_TIMEOUT_MS = 5_000

type ResearchCampaignOperationLockResultWithCleanup = ResearchCampaignOperationLockResult | (Extract<ResearchCampaignOperationLockResult, { readonly kind: "error" }> & {
  readonly cleanup_failure: Extract<ResearchCampaignWriteLockReleaseResult, { readonly kind: "error" }>
})

type ResearchCampaignOperationLockReleaseResultWithCleanup = ResearchCampaignOperationLockReleaseResult | (Extract<ResearchCampaignOperationLockReleaseResult, { readonly kind: "error" }> & {
  readonly cleanup_failure: Extract<ResearchCampaignWriteLockReleaseResult, { readonly kind: "error" }>
})

async function removeRecoveryArchive(path: string, runtime: StorageRuntime): Promise<boolean> {
  try {
    await runtime.unlink(path)
    return true
  } catch (error) {
    return getFilesystemErrorCode(error) === "ENOENT"
  }
}

function operationOwner(operationId: string, runtime: StorageRuntime): ResearchCampaignOperationOwner {
  return {
    token: runtime.token(),
    pid: runtime.pid,
    operation_id: operationId,
    started_at: new Date(runtime.now()).toISOString(),
  }
}

async function acquireOperationLock(
  request: { readonly campaign_directory: string; readonly operation_id: string },
  runtime: StorageRuntime,
): Promise<ResearchCampaignOperationLockResult> {
  const lockPath = join(request.campaign_directory, ".operation.lock")
  const operationId = parseResearchCampaignOperationId(request.operation_id)
  if (operationId === null) {
    return { kind: "error", error_code: "STORAGE_WRITE_FAILED", message: "Research campaign operation ID is invalid" }
  }
  const owner = operationOwner(operationId, runtime)
  try {
    await runtime.writeExclusive(lockPath, serializeResearchCampaignOperationOwner(owner))
    return { kind: "acquired", owner, recovered_owner: null }
  } catch (error) {
    const code = getFilesystemErrorCode(error)
    if (ATOMICITY_CODES.has(code ?? "")) {
      return { kind: "error", error_code: "STORAGE_ATOMICITY_UNAVAILABLE", message: "Exclusive research campaign operation ownership is unavailable" }
    }
    if (code !== "EEXIST") {
      return { kind: "error", error_code: "STORAGE_WRITE_FAILED", message: "Unable to create research campaign operation lock" }
    }
  }

  const current = await inspectResearchCampaignOperationLock(lockPath, runtime)
  if (current.kind !== "valid") {
    return {
      kind: "error",
      error_code: "STORAGE_READ_FAILED",
      message: current.kind === "missing" ? "Research campaign operation lock changed during acquisition" : "Research campaign operation lock is unverifiable",
    }
  }
  let processStatus: ReturnType<StorageRuntime["processStatus"]>
  try {
    processStatus = runtime.processStatus(current.owner.pid)
  } catch (error) {
    await current.handle.close()
    throw error
  }
  if (processStatus !== "dead" || current.owner.operation_id !== request.operation_id) {
    await current.handle.close()
    return { kind: "error", error_code: "STORAGE_BUSY", message: "Research campaign operation is owned by another worker" }
  }

  const replacementPath = join(request.campaign_directory, `.operation-recovery-${current.owner.token}-${owner.token}`)
  try {
    await runtime.writeExclusive(replacementPath, serializeResearchCampaignOperationOwner(owner))
    const publicMatches = await runtime.sameIdentity(lockPath, current.identity)
    if (!publicMatches) {
      const replacementRemoved = await removeRecoveryArchive(replacementPath, runtime)
      await current.handle.close()
      return replacementRemoved
        ? { kind: "error", error_code: "STORAGE_BUSY", message: "Research campaign operation owner changed during recovery" }
        : { kind: "error", error_code: "STORAGE_WRITE_FAILED", message: "Unable to clean research campaign operation recovery candidate" }
    }
    await runtime.rename(replacementPath, lockPath)
  } catch (error) {
    const replacementRemoved = await removeRecoveryArchive(replacementPath, runtime)
    await current.handle.close()
    if (!replacementRemoved) {
      return { kind: "error", error_code: "STORAGE_WRITE_FAILED", message: "Unable to clean research campaign operation recovery candidate" }
    }
    return ATOMICITY_CODES.has(getFilesystemErrorCode(error) ?? "")
      ? { kind: "error", error_code: "STORAGE_ATOMICITY_UNAVAILABLE", message: "Atomic research campaign operation recovery is unavailable" }
      : { kind: "error", error_code: "STORAGE_WRITE_FAILED", message: "Unable to retire dead research campaign operation owner" }
  }
  await current.handle.close()
  return { kind: "acquired", owner, recovered_owner: current.owner }
}

async function releaseOperationLock(
  owner: { readonly campaign_directory: string; readonly token: string },
  runtime: StorageRuntime,
): Promise<ResearchCampaignOperationLockReleaseResult> {
  const lockPath = join(owner.campaign_directory, ".operation.lock")
  const current = await inspectResearchCampaignOperationLock(lockPath, runtime)
  if (current.kind === "missing") return { kind: "ok" }
  if (current.kind === "unverifiable") {
    return { kind: "error", error_code: "STORAGE_READ_FAILED", message: "Owned research campaign operation lock is unverifiable" }
  }
  let identityMatches: boolean
  try {
    identityMatches = await runtime.sameIdentity(lockPath, current.identity)
  } catch (error) {
    await current.handle.close()
    throw error
  }
  if (current.owner.token !== owner.token || !identityMatches) {
    await current.handle.close()
    return { kind: "error", error_code: "STORAGE_BUSY", message: "Research campaign operation lock belongs to another owner" }
  }
  try {
    await runtime.unlink(lockPath)
    await current.handle.close()
    return { kind: "ok" }
  } catch (error) {
    await current.handle.close()
    if (!(error instanceof Error)) throw error
    return { kind: "error", error_code: "STORAGE_WRITE_FAILED", message: "Unable to remove owned research campaign operation lock" }
  }
}

export async function acquireResearchCampaignOperationLock(
  request: { readonly campaign_directory: string; readonly operation_id: string },
  runtime: StorageRuntime = nodeStorageRuntime,
): Promise<ResearchCampaignOperationLockResultWithCleanup> {
  const writeLock = await acquireResearchCampaignWriteLock({
    campaign_directory: request.campaign_directory,
    timeout_ms: OPERATION_METADATA_LOCK_TIMEOUT_MS,
  }, runtime)
  if (writeLock.kind === "error") return writeLock
  let outcome: ResearchCampaignOperationLockResult
  try {
    outcome = await acquireOperationLock(request, runtime)
  } catch (error) {
    return rethrowAfterResearchCampaignLockCleanup(error, () =>
      releaseResearchCampaignWriteLock({ campaign_directory: request.campaign_directory, token: writeLock.token }, runtime))
  }
  const released = await releaseResearchCampaignWriteLock({ campaign_directory: request.campaign_directory, token: writeLock.token }, runtime)
  if (released.kind === "error" && outcome.kind === "error") {
    return { ...outcome, cleanup_failure: released }
  }
  return released.kind === "error" ? released : outcome
}

export async function releaseResearchCampaignOperationLock(
  owner: { readonly campaign_directory: string; readonly token: string },
  runtime: StorageRuntime = nodeStorageRuntime,
): Promise<ResearchCampaignOperationLockReleaseResultWithCleanup> {
  const writeLock = await acquireResearchCampaignWriteLock({
    campaign_directory: owner.campaign_directory,
    timeout_ms: OPERATION_METADATA_LOCK_TIMEOUT_MS,
  }, runtime)
  if (writeLock.kind === "error") return writeLock
  let outcome: ResearchCampaignOperationLockReleaseResult
  try {
    outcome = await releaseOperationLock(owner, runtime)
  } catch (error) {
    return rethrowAfterResearchCampaignLockCleanup(error, () =>
      releaseResearchCampaignWriteLock({ campaign_directory: owner.campaign_directory, token: writeLock.token }, runtime))
  }
  const released = await releaseResearchCampaignWriteLock({ campaign_directory: owner.campaign_directory, token: writeLock.token }, runtime)
  if (released.kind === "error" && outcome.kind === "error") {
    return { ...outcome, cleanup_failure: released }
  }
  return released.kind === "error" ? released : outcome
}
