import { join } from "node:path"
import { z } from "zod"

import { nodeStorageRuntime } from "./node-storage-runtime"
import type { StorageFileHandle, StorageRuntime } from "./storage-runtime-contract"
import type { WriteLockReleaseResult, WriteLockResult } from "./storage-results"

const POLL_INTERVAL_MS = 50
const STALE_LOCK_AGE_MS = 30_000
const ATOMICITY_CODES = new Set(["ENOSYS", "ENOTSUP", "EOPNOTSUPP", "EINVAL", "EXDEV", "EPERM"])
const WriteLockSchema = z.object({
  token: z.string().regex(/^[a-zA-Z0-9-]{1,128}$/),
  pid: z.number().int().positive(),
  started_at: z.string().datetime({ offset: true }),
}).strict()

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined
  return typeof error.code === "string" ? error.code : undefined
}

async function inspectLock(path: string, runtime: StorageRuntime) {
  let handle: StorageFileHandle
  try {
    handle = await runtime.open(path, "r")
  } catch (error) {
    return errorCode(error) === "ENOENT" ? { kind: "missing" as const } : { kind: "unverifiable" as const }
  }
  try {
    const [content, identity] = await Promise.all([handle.readFile(), handle.identity()])
    const raw: unknown = JSON.parse(content)
    const parsed = WriteLockSchema.safeParse(raw)
    if (!parsed.success) {
      await handle.close()
      return { kind: "unverifiable" as const }
    }
    return { kind: "valid" as const, record: parsed.data, identity, handle }
  } catch (error) {
    await handle.close()
    return error instanceof SyntaxError ? { kind: "unverifiable" as const } : { kind: "unverifiable" as const }
  }
}

async function closeInspection(inspected: { readonly handle: StorageFileHandle }): Promise<void> {
  await inspected.handle.close()
}

export async function acquireWorkflowWriteLock(
  request: { readonly run_directory: string; readonly timeout_ms: number },
  runtime: StorageRuntime = nodeStorageRuntime,
): Promise<WriteLockResult> {
  const lockPath = join(request.run_directory, ".write.lock")
  const token = runtime.token()
  const deadline = runtime.now() + request.timeout_ms
  let staleRecoveryAttempted = false

  while (true) {
    const record = { token, pid: runtime.pid, started_at: new Date(runtime.now()).toISOString() }
    try {
      await runtime.writeExclusive(lockPath, JSON.stringify(record))
      return { kind: "acquired", token }
    } catch (error) {
      const code = errorCode(error)
      if (ATOMICITY_CODES.has(code ?? "")) {
        return { kind: "error", error_code: "STORAGE_ATOMICITY_UNAVAILABLE", message: "Exclusive lock creation is unavailable" }
      }
      if (code !== "EEXIST") {
        return { kind: "error", error_code: "STORAGE_WRITE_FAILED", message: "Unable to create workflow write lock" }
      }
    }

    const current = await inspectLock(lockPath, runtime)
    if (current.kind === "missing") continue
    if (current.kind === "valid") {
      const age = runtime.now() - Date.parse(current.record.started_at)
      const stale = !staleRecoveryAttempted && age > STALE_LOCK_AGE_MS && runtime.processStatus(current.record.pid) === "dead"
      if (stale) {
        staleRecoveryAttempted = true
        const stalePath = join(request.run_directory, `.stale-lock-${current.record.token}`)
        let archiveCreated = false
        try {
          await runtime.link(lockPath, stalePath)
          archiveCreated = true
          const archiveMatches = await runtime.sameIdentity(stalePath, current.identity)
          const publicMatches = await runtime.sameIdentity(lockPath, current.identity)
          if (archiveMatches && publicMatches) {
            await runtime.unlink(lockPath)
            await runtime.unlink(stalePath)
            archiveCreated = false
            await closeInspection(current)
            continue
          }
          await runtime.unlink(stalePath)
          archiveCreated = false
        } catch (error) {
          if (archiveCreated) {
            try {
              await runtime.unlink(stalePath)
            } catch {
              await closeInspection(current)
              return { kind: "error", error_code: "STORAGE_WRITE_FAILED", message: "Unable to remove stale-lock archive" }
            }
          }
          if (ATOMICITY_CODES.has(errorCode(error) ?? "")) {
            await closeInspection(current)
            return { kind: "error", error_code: "STORAGE_ATOMICITY_UNAVAILABLE", message: "Atomic stale-lock retirement is unavailable" }
          }
        }
      }
      await closeInspection(current)
    }

    const remaining = deadline - runtime.now()
    if (remaining <= 0) {
      return { kind: "error", error_code: "STORAGE_BUSY", message: "Workflow write lock remained contended" }
    }
    await runtime.sleep(Math.min(POLL_INTERVAL_MS, remaining))
  }
}

export async function releaseWorkflowWriteLock(
  owner: { readonly run_directory: string; readonly token: string },
  runtime: StorageRuntime = nodeStorageRuntime,
): Promise<WriteLockReleaseResult> {
  const lockPath = join(owner.run_directory, ".write.lock")
  const current = await inspectLock(lockPath, runtime)
  if (current.kind === "missing") return { kind: "ok" }
  if (current.kind === "unverifiable") {
    return { kind: "error", error_code: "STORAGE_WRITE_FAILED", message: "Owned workflow lock became unverifiable" }
  }
  if (current.record.token !== owner.token || !await runtime.sameIdentity(lockPath, current.identity)) {
    await closeInspection(current)
    return { kind: "ok" }
  }
  try {
    await runtime.unlink(lockPath)
    await closeInspection(current)
    return { kind: "ok" }
  } catch (error) {
    await closeInspection(current)
    return { kind: "error", error_code: "STORAGE_WRITE_FAILED", message: "Unable to remove owned workflow lock" }
  }
}
