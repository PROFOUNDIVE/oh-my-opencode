import {
  acquireWorkflowWriteLock,
  releaseWorkflowWriteLock,
} from "../../workflow/storage/write-lock"
import { nodeStorageRuntime } from "../../workflow/storage/node-storage-runtime"
import type { StorageRuntime } from "../../workflow/storage/storage-runtime-contract"
import type {
  ResearchCampaignWriteLockReleaseResult,
  ResearchCampaignWriteLockResult,
} from "./storage-results"

export async function acquireResearchCampaignWriteLock(
  request: { readonly campaign_directory: string; readonly timeout_ms: number },
  runtime: StorageRuntime = nodeStorageRuntime,
): Promise<ResearchCampaignWriteLockResult> {
  const result = await acquireWorkflowWriteLock({
    run_directory: request.campaign_directory,
    timeout_ms: request.timeout_ms,
  }, runtime)
  if (result.kind === "acquired") return result
  const messages = {
    STORAGE_ATOMICITY_UNAVAILABLE: "Exclusive research campaign write-lock creation is unavailable",
    STORAGE_BUSY: "Research campaign write lock remained contended",
    STORAGE_WRITE_FAILED: "Unable to create research campaign write lock",
  } as const
  return { ...result, message: messages[result.error_code] }
}

export async function releaseResearchCampaignWriteLock(
  owner: { readonly campaign_directory: string; readonly token: string },
  runtime: StorageRuntime = nodeStorageRuntime,
): Promise<ResearchCampaignWriteLockReleaseResult> {
  const result = await releaseWorkflowWriteLock({
    run_directory: owner.campaign_directory,
    token: owner.token,
  }, runtime)
  if (result.kind === "ok") return result
  const messages = {
    STORAGE_ATOMICITY_UNAVAILABLE: "Atomic research campaign write-lock release is unavailable",
    STORAGE_WRITE_FAILED: "Unable to release owned research campaign write lock",
  } as const
  return { ...result, message: messages[result.error_code] }
}
