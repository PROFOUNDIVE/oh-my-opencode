import { join } from "node:path"

import { nodeStorageRuntime } from "../workflow/storage/node-storage-runtime"
import type {
  StorageFileHandle,
  StorageFileIdentity,
  StorageRuntime,
} from "../workflow/storage/storage-runtime-contract"

const ATOMICITY_CODES = new Set(["ENOSYS", "ENOTSUP", "EOPNOTSUPP", "EINVAL", "EXDEV", "EPERM"])
const DIRECTORY_SYNC_UNSUPPORTED = new Set(["ENOTSUP", "EOPNOTSUPP", "EINVAL", "EISDIR"])

type AtomicityFailureReason = "EXCLUSIVE_TEMP_CREATE_UNAVAILABLE" | "NO_REPLACE_PUBLICATION_UNAVAILABLE"
  | "OWNERSHIP_BOUND_TEMP_CREATE_UNAVAILABLE" | "TEMP_QUARANTINE_UNAVAILABLE" | "TEMP_RESTORATION_UNAVAILABLE"

type WriteFailureReason = "DURABLE_TEMP_WRITE_FAILED" | "EXCLUSIVE_TEMP_IDENTITY_CHANGED" | "OWNED_TEMP_REMOVE_FAILED"
  | "REVISION_ALREADY_ALLOCATED" | "REVISION_PUBLICATION_FAILED" | "RUN_DIRECTORY_CLOSE_FAILED"
  | "RUN_DIRECTORY_OPEN_FAILED" | "RUN_DIRECTORY_SYNC_FAILED" | "TEMP_CREATE_FAILED" | "TEMP_OWNERSHIP_BIND_FAILED"
  | "TEMP_OWNERSHIP_BINDING_CHANGED" | "TEMP_OWNERSHIP_CHANGED_BEFORE_PUBLICATION" | "TEMP_OWNERSHIP_VERIFY_FAILED"
  | "TEMP_QUARANTINE_FAILED" | "TEMP_RESTORE_FAILED"

type BoundTemp = Readonly<{ tempPath: string; ownerPath: string; identity: StorageFileIdentity }>

export type ImmutableJsonRevisionFailureReason = AtomicityFailureReason | WriteFailureReason

export type ImmutableJsonRevisionWriteResult =
  | { readonly kind: "ok" }
  | { readonly kind: "error"; readonly error_code: "STORAGE_ATOMICITY_UNAVAILABLE"; readonly reason: AtomicityFailureReason }
  | { readonly kind: "error"; readonly error_code: "STORAGE_WRITE_FAILED"; readonly reason: WriteFailureReason }

function atomicityFailure(reason: AtomicityFailureReason): ImmutableJsonRevisionWriteResult {
  return { kind: "error", error_code: "STORAGE_ATOMICITY_UNAVAILABLE", reason }
}

function writeFailure(reason: WriteFailureReason): ImmutableJsonRevisionWriteResult {
  return { kind: "error", error_code: "STORAGE_WRITE_FAILED", reason }
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined
  return typeof error.code === "string" ? error.code : undefined
}

async function removeOwnedPath(path: string, runtime: StorageRuntime): Promise<ImmutableJsonRevisionWriteResult> {
  try {
    await runtime.unlink(path)
    return { kind: "ok" }
  } catch (error) {
    return errorCode(error) === "ENOENT" ? { kind: "ok" } : writeFailure("OWNED_TEMP_REMOVE_FAILED")
  }
}

async function restoreCapturedPath(
  capturedPath: string,
  originalPath: string,
  runtime: StorageRuntime,
): Promise<ImmutableJsonRevisionWriteResult> {
  try {
    await runtime.link(capturedPath, originalPath)
  } catch (error) {
    return ATOMICITY_CODES.has(errorCode(error) ?? "")
      ? atomicityFailure("TEMP_RESTORATION_UNAVAILABLE")
      : writeFailure("TEMP_RESTORE_FAILED")
  }
  return removeOwnedPath(capturedPath, runtime)
}

async function cleanupBoundTemp(
  boundTemp: BoundTemp,
  runtime: StorageRuntime,
): Promise<ImmutableJsonRevisionWriteResult> {
  const { tempPath, ownerPath, identity } = boundTemp
  const capturedPath = `${tempPath}.cleanup-${runtime.token()}`
  try {
    await runtime.rename(tempPath, capturedPath)
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      return ATOMICITY_CODES.has(errorCode(error) ?? "")
        ? atomicityFailure("TEMP_QUARANTINE_UNAVAILABLE")
        : writeFailure("TEMP_QUARANTINE_FAILED")
    }
    return removeOwnedPath(ownerPath, runtime)
  }

  let capturedIsOwned: boolean
  try {
    capturedIsOwned = await runtime.sameIdentity(capturedPath, identity)
  } catch (error) {
    const restored = await restoreCapturedPath(capturedPath, tempPath, runtime)
    return restored.kind === "error" ? restored : writeFailure("TEMP_OWNERSHIP_VERIFY_FAILED")
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

async function syncRunDirectory(
  runDirectory: string,
  runtime: StorageRuntime,
): Promise<ImmutableJsonRevisionWriteResult> {
  let handle: StorageFileHandle
  try {
    handle = await runtime.open(runDirectory, "r")
  } catch (error) {
    if (DIRECTORY_SYNC_UNSUPPORTED.has(errorCode(error) ?? "")) return { kind: "ok" }
    if (!(error instanceof Error)) throw error
    return writeFailure("RUN_DIRECTORY_OPEN_FAILED")
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
    return writeFailure("RUN_DIRECTORY_CLOSE_FAILED")
  }
  return syncError === undefined ? { kind: "ok" } : writeFailure("RUN_DIRECTORY_SYNC_FAILED")
}

export async function writeImmutableJsonRevision(
  request: {
    readonly run_directory: string
    readonly build_revision_path: (runDirectory: string) => string
    readonly serialized_bytes: string
  },
  runtime: StorageRuntime = nodeStorageRuntime,
): Promise<ImmutableJsonRevisionWriteResult> {
  const revisionPath = request.build_revision_path(request.run_directory)
  const tempPath = join(request.run_directory, `.tmp-${runtime.token()}`)
  const ownerPath = `${tempPath}.owner`
  let handle: StorageFileHandle
  try {
    handle = await runtime.open(tempPath, "wx")
  } catch (error) {
    if (ATOMICITY_CODES.has(errorCode(error) ?? "")) return atomicityFailure("EXCLUSIVE_TEMP_CREATE_UNAVAILABLE")
    if (!(error instanceof Error)) throw error
    return writeFailure("TEMP_CREATE_FAILED")
  }
  const identity = await handle.identity()
  const boundTemp = { tempPath, ownerPath, identity }
  try {
    if (!await runtime.sameIdentity(tempPath, identity)) {
      await handle.close()
      return writeFailure("EXCLUSIVE_TEMP_IDENTITY_CHANGED")
    }
    await runtime.link(tempPath, ownerPath)
    if (!await runtime.sameIdentity(ownerPath, identity)) {
      await handle.close()
      await removeOwnedPath(ownerPath, runtime)
      return writeFailure("TEMP_OWNERSHIP_BINDING_CHANGED")
    }
  } catch (error) {
    try {
      await handle.close()
    } catch (closeError) {
      if (!(closeError instanceof Error)) throw closeError
    }
    await removeOwnedPath(tempPath, runtime)
    return ATOMICITY_CODES.has(errorCode(error) ?? "")
      ? atomicityFailure("OWNERSHIP_BOUND_TEMP_CREATE_UNAVAILABLE")
      : writeFailure("TEMP_OWNERSHIP_BIND_FAILED")
  }

  let fileError: unknown
  try {
    await handle.writeFile(request.serialized_bytes)
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
    const cleaned = await cleanupBoundTemp(boundTemp, runtime)
    return cleaned.kind === "error" ? cleaned : writeFailure("DURABLE_TEMP_WRITE_FAILED")
  }

  try {
    if (!await runtime.sameIdentity(ownerPath, identity)) {
      const cleaned = await cleanupBoundTemp(boundTemp, runtime)
      return cleaned.kind === "error" ? cleaned : writeFailure("TEMP_OWNERSHIP_CHANGED_BEFORE_PUBLICATION")
    }
    await runtime.link(ownerPath, revisionPath)
  } catch (error) {
    const cleaned = await cleanupBoundTemp(boundTemp, runtime)
    if (cleaned.kind === "error") return cleaned
    if (errorCode(error) === "EEXIST") return writeFailure("REVISION_ALREADY_ALLOCATED")
    if (ATOMICITY_CODES.has(errorCode(error) ?? "")) return atomicityFailure("NO_REPLACE_PUBLICATION_UNAVAILABLE")
    if (!(error instanceof Error)) throw error
    return writeFailure("REVISION_PUBLICATION_FAILED")
  }
  const cleaned = await cleanupBoundTemp(boundTemp, runtime)
  if (cleaned.kind === "error") return cleaned
  return syncRunDirectory(request.run_directory, runtime)
}
