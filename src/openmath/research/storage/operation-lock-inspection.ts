import { join } from "node:path"

import { nodeStorageRuntime } from "../../workflow/storage/node-storage-runtime"
import type {
  StorageFileHandle,
  StorageFileIdentity,
  StorageRuntime,
} from "../../workflow/storage/storage-runtime-contract"
import { getFilesystemErrorCode } from "./filesystem-error-code"
import { parseResearchCampaignOperationOwner } from "./operation-lock-record"
import type {
  ResearchCampaignOperationLockReadResult,
  ResearchCampaignOperationOwner,
} from "./storage-results"

export type ResearchCampaignOperationLockInspection =
  | { readonly kind: "missing" }
  | { readonly kind: "unverifiable" }
  | {
      readonly kind: "valid"
      readonly owner: ResearchCampaignOperationOwner
      readonly identity: StorageFileIdentity
      readonly handle: StorageFileHandle
    }

export async function inspectResearchCampaignOperationLock(
  path: string,
  runtime: StorageRuntime,
): Promise<ResearchCampaignOperationLockInspection> {
  let handle: StorageFileHandle
  try {
    handle = await runtime.open(path, "r")
  } catch (error) {
    return getFilesystemErrorCode(error) === "ENOENT" ? { kind: "missing" } : { kind: "unverifiable" }
  }
  try {
    const [content, identity] = await Promise.all([handle.readFile(), handle.identity()])
    const owner = parseResearchCampaignOperationOwner(content)
    if (owner === null) {
      await handle.close()
      return { kind: "unverifiable" }
    }
    return { kind: "valid", owner, identity, handle }
  } catch (error) {
    await handle.close()
    if (!(error instanceof Error)) throw error
    return { kind: "unverifiable" }
  }
}

export async function readResearchCampaignOperationLock(
  campaignDirectory: string,
  runtime: StorageRuntime = nodeStorageRuntime,
): Promise<ResearchCampaignOperationLockReadResult> {
  const inspected = await inspectResearchCampaignOperationLock(join(campaignDirectory, ".operation.lock"), runtime)
  if (inspected.kind === "missing") return { kind: "unlocked" }
  if (inspected.kind === "unverifiable") {
    return { kind: "error", error_code: "STORAGE_READ_FAILED", message: "Research campaign operation lock is unverifiable" }
  }
  const processStatus = runtime.processStatus(inspected.owner.pid)
  await inspected.handle.close()
  return { kind: "owned", owner: inspected.owner, process_status: processStatus }
}
