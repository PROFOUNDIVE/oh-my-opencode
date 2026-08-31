import type { StorageFileHandle, StorageRuntime } from "../workflow/storage/storage-runtime-contract"
import type { ImmutableJsonRevisionWriteResult } from "./immutable-json-revision-writer"

const DIRECTORY_SYNC_UNSUPPORTED = new Set(["ENOTSUP", "EOPNOTSUPP", "EINVAL", "EISDIR"])

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined
  return typeof error.code === "string" ? error.code : undefined
}

export async function syncImmutableJsonRevisionDirectory(
  directory: string,
  runtime: StorageRuntime,
): Promise<ImmutableJsonRevisionWriteResult> {
  let handle: StorageFileHandle
  try {
    handle = await runtime.open(directory, "r")
  } catch (error) {
    if (DIRECTORY_SYNC_UNSUPPORTED.has(errorCode(error) ?? "")) return { kind: "ok" }
    if (!(error instanceof Error)) throw error
    return { kind: "error", error_code: "STORAGE_WRITE_FAILED", reason: "RUN_DIRECTORY_OPEN_FAILED" }
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
    return { kind: "error", error_code: "STORAGE_WRITE_FAILED", reason: "RUN_DIRECTORY_CLOSE_FAILED" }
  }
  return syncError === undefined
    ? { kind: "ok" }
    : { kind: "error", error_code: "STORAGE_WRITE_FAILED", reason: "RUN_DIRECTORY_SYNC_FAILED" }
}
