import { join } from "node:path"

import type { WorkflowStateV1 } from "../state"
import { nodeStorageRuntime } from "./node-storage-runtime"
import { getWorkflowRevisionPath } from "./revision-filename"
import type { StorageFileHandle, StorageFileIdentity, StorageRuntime } from "./storage-runtime-contract"
import type { AtomicWriteResult } from "./storage-results"

const ATOMICITY_CODES = new Set(["ENOSYS", "ENOTSUP", "EOPNOTSUPP", "EINVAL", "EXDEV", "EPERM"])
const DIRECTORY_SYNC_UNSUPPORTED = new Set(["ENOTSUP", "EOPNOTSUPP", "EINVAL", "EISDIR"])

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined
  return typeof error.code === "string" ? error.code : undefined
}

async function removeOwnedPath(path: string, runtime: StorageRuntime): Promise<AtomicWriteResult> {
  try {
    await runtime.unlink(path)
    return { kind: "ok" }
  } catch (error) {
    return errorCode(error) === "ENOENT"
      ? { kind: "ok" }
      : { kind: "error", error_code: "STORAGE_WRITE_FAILED", message: "Unable to remove owned workflow temp" }
  }
}

async function restoreCapturedPath(
  capturedPath: string,
  originalPath: string,
  runtime: StorageRuntime,
): Promise<AtomicWriteResult> {
  try {
    await runtime.link(capturedPath, originalPath)
  } catch (error) {
    if (ATOMICITY_CODES.has(errorCode(error) ?? "")) {
      return { kind: "error", error_code: "STORAGE_ATOMICITY_UNAVAILABLE", message: "Atomic temp restoration is unavailable" }
    }
    return { kind: "error", error_code: "STORAGE_WRITE_FAILED", message: "Unable to restore replacement workflow temp" }
  }
  return removeOwnedPath(capturedPath, runtime)
}

async function cleanupBoundTemp(
  tempPath: string,
  ownerPath: string,
  identity: StorageFileIdentity,
  runtime: StorageRuntime,
): Promise<AtomicWriteResult> {
  const capturedPath = `${tempPath}.cleanup-${runtime.token()}`
  try {
    await runtime.rename(tempPath, capturedPath)
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      return ATOMICITY_CODES.has(errorCode(error) ?? "")
        ? { kind: "error", error_code: "STORAGE_ATOMICITY_UNAVAILABLE", message: "Atomic temp quarantine is unavailable" }
        : { kind: "error", error_code: "STORAGE_WRITE_FAILED", message: "Unable to quarantine workflow temp" }
    }
    return removeOwnedPath(ownerPath, runtime)
  }

  let capturedIsOwned: boolean
  try {
    capturedIsOwned = await runtime.sameIdentity(capturedPath, identity)
  } catch (error) {
    const restored = await restoreCapturedPath(capturedPath, tempPath, runtime)
    return restored.kind === "error"
      ? restored
      : { kind: "error", error_code: "STORAGE_WRITE_FAILED", message: "Unable to verify workflow temp ownership" }
  }
  if (capturedIsOwned) {
    const removedCapture = await removeOwnedPath(capturedPath, runtime)
    if (removedCapture.kind === "error") return removedCapture
  } else {
    const restored = await restoreCapturedPath(capturedPath, tempPath, runtime)
    if (restored.kind === "error") return restored
  }
  try {
    if (await runtime.sameIdentity(ownerPath, identity)) return removeOwnedPath(ownerPath, runtime)
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { kind: "ok" }
  }
  return { kind: "ok" }
}

async function syncRunDirectory(runDirectory: string, runtime: StorageRuntime): Promise<AtomicWriteResult> {
  let handle: StorageFileHandle
  try {
    handle = await runtime.open(runDirectory, "r")
  } catch (error) {
    if (DIRECTORY_SYNC_UNSUPPORTED.has(errorCode(error) ?? "")) return { kind: "ok" }
    if (!(error instanceof Error)) throw error
    return { kind: "error", error_code: "STORAGE_WRITE_FAILED", message: "Unable to open workflow directory for fsync" }
  }

  let syncError: unknown
  try {
    await handle.sync()
  } catch (error) {
    if (!(error instanceof Error)) throw error
    if (!DIRECTORY_SYNC_UNSUPPORTED.has(errorCode(error) ?? "")) syncError = error
  }
  try {
    await handle.close()
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return { kind: "error", error_code: "STORAGE_WRITE_FAILED", message: "Unable to close workflow directory after fsync" }
  }
  return syncError === undefined
    ? { kind: "ok" }
    : { kind: "error", error_code: "STORAGE_WRITE_FAILED", message: "Unable to fsync workflow directory" }
}

export async function writeImmutableWorkflowRevision(
  request: { readonly run_directory: string; readonly revision: number; readonly state: WorkflowStateV1 },
  runtime: StorageRuntime = nodeStorageRuntime,
): Promise<AtomicWriteResult> {
  const revisionPath = getWorkflowRevisionPath(request.run_directory, request.revision)
  const tempPath = join(request.run_directory, `.tmp-${runtime.token()}`)
  const ownerPath = `${tempPath}.owner`
  let handle: StorageFileHandle
  try {
    handle = await runtime.open(tempPath, "wx")
  } catch (error) {
    if (ATOMICITY_CODES.has(errorCode(error) ?? "")) {
      return { kind: "error", error_code: "STORAGE_ATOMICITY_UNAVAILABLE", message: "Exclusive temp creation is unavailable" }
    }
    if (!(error instanceof Error)) throw error
    return { kind: "error", error_code: "STORAGE_WRITE_FAILED", message: "Unable to create workflow temp file" }
  }
  const identity = await handle.identity()
  try {
    if (!await runtime.sameIdentity(tempPath, identity)) {
      await handle.close()
      return { kind: "error", error_code: "STORAGE_WRITE_FAILED", message: "Exclusive workflow temp identity changed" }
    }
    await runtime.link(tempPath, ownerPath)
    if (!await runtime.sameIdentity(ownerPath, identity)) {
      await handle.close()
      await removeOwnedPath(ownerPath, runtime)
      return { kind: "error", error_code: "STORAGE_WRITE_FAILED", message: "Workflow temp ownership binding changed" }
    }
  } catch (error) {
    try {
      await handle.close()
    } catch (closeError) {
      if (!(closeError instanceof Error)) throw closeError
    }
    await removeOwnedPath(tempPath, runtime)
    if (ATOMICITY_CODES.has(errorCode(error) ?? "")) {
      return { kind: "error", error_code: "STORAGE_ATOMICITY_UNAVAILABLE", message: "Ownership-bound temp creation is unavailable" }
    }
    return { kind: "error", error_code: "STORAGE_WRITE_FAILED", message: "Unable to bind workflow temp ownership" }
  }

  let fileError: unknown
  try {
    await handle.writeFile(JSON.stringify(request.state, null, 2))
    await handle.sync()
  } catch (error) {
    if (!(error instanceof Error)) throw error
    fileError = error
  }
  try {
    await handle.close()
  } catch (error) {
    if (!(error instanceof Error)) throw error
    if (fileError === undefined) fileError = error
  }
  if (fileError !== undefined) {
    const cleaned = await cleanupBoundTemp(tempPath, ownerPath, identity, runtime)
    if (cleaned.kind === "error") return cleaned
    return { kind: "error", error_code: "STORAGE_WRITE_FAILED", message: "Unable to durably write workflow temp file" }
  }

  try {
    if (!await runtime.sameIdentity(ownerPath, identity)) {
      const cleaned = await cleanupBoundTemp(tempPath, ownerPath, identity, runtime)
      if (cleaned.kind === "error") return cleaned
      return { kind: "error", error_code: "STORAGE_WRITE_FAILED", message: "Workflow temp ownership changed before publication" }
    }
    await runtime.link(ownerPath, revisionPath)
  } catch (error) {
    const cleaned = await cleanupBoundTemp(tempPath, ownerPath, identity, runtime)
    if (cleaned.kind === "error") return cleaned
    if (errorCode(error) === "EEXIST") {
      return { kind: "error", error_code: "STORAGE_WRITE_FAILED", message: "Workflow revision is already allocated" }
    }
    if (ATOMICITY_CODES.has(errorCode(error) ?? "")) {
      return { kind: "error", error_code: "STORAGE_ATOMICITY_UNAVAILABLE", message: "Atomic no-replace publication is unavailable" }
    }
    if (!(error instanceof Error)) throw error
    return { kind: "error", error_code: "STORAGE_WRITE_FAILED", message: "Unable to publish workflow revision" }
  }
  const cleaned = await cleanupBoundTemp(tempPath, ownerPath, identity, runtime)
  if (cleaned.kind === "error") return cleaned
  return syncRunDirectory(request.run_directory, runtime)
}
