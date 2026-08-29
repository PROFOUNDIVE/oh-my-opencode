import { nodeStorageRuntime } from "../../workflow/storage/node-storage-runtime"
import type { StorageRuntime } from "../../workflow/storage/storage-runtime-contract"
import { ResearchCampaignStateV1Schema, type ResearchCampaignStateV1 } from "../state"
import { getResearchCampaignDirectory } from "./campaign-directory-hash"
import { writeImmutableResearchCampaignRevision } from "./immutable-revision-writer"
import { readResearchCampaignState } from "./reader"
import type { ResearchCampaignMutationResult, ResearchCampaignWriteLockReleaseResult } from "./storage-results"
import { acquireResearchCampaignWriteLock, releaseResearchCampaignWriteLock } from "./write-lock"
import { rethrowAfterResearchCampaignLockCleanup } from "./lock-cleanup-error"

const START_LOCK_TIMEOUT_MS = 30_000

type ResearchCampaignMutationResultWithCleanup = ResearchCampaignMutationResult | (Extract<ResearchCampaignMutationResult, { readonly kind: "error" }> & {
  readonly cleanup_failure: Extract<ResearchCampaignWriteLockReleaseResult, { readonly kind: "error" }>
})

export async function startResearchCampaignState(
  request: { readonly directory: string; readonly state: ResearchCampaignStateV1 },
  runtime: StorageRuntime = nodeStorageRuntime,
): Promise<ResearchCampaignMutationResultWithCleanup> {
  const parsed = ResearchCampaignStateV1Schema.safeParse(request.state)
  if (!parsed.success || parsed.data.state_revision !== 0) {
    return {
      kind: "error",
      error_code: "STORAGE_WRITE_FAILED",
      message: "Initial research campaign state must be strict revision zero",
    }
  }
  const campaignDirectory = getResearchCampaignDirectory(request.directory, parsed.data.campaign_id)
  try {
    await runtime.mkdir(campaignDirectory)
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return { kind: "error", error_code: "STORAGE_WRITE_FAILED", message: "Unable to create research campaign directory" }
  }
  const lock = await acquireResearchCampaignWriteLock({
    campaign_directory: campaignDirectory,
    timeout_ms: START_LOCK_TIMEOUT_MS,
  }, runtime)
  if (lock.kind === "error") {
    if (lock.error_code !== "STORAGE_BUSY") return lock
    const allocated = await readResearchCampaignState(request.directory, parsed.data.campaign_id, runtime)
    if (allocated.kind === "ok") {
      return {
        kind: "error",
        error_code: "CAMPAIGN_ALREADY_EXISTS",
        message: `Research campaign ${parsed.data.campaign_id} already exists`,
      }
    }
    return allocated.error_code === "STORAGE_READ_FAILED" ? allocated : lock
  }

  let outcome: ResearchCampaignMutationResult
  try {
    const existing = await readResearchCampaignState(request.directory, parsed.data.campaign_id, runtime)
    if (existing.kind === "ok") {
      outcome = {
        kind: "error",
        error_code: "CAMPAIGN_ALREADY_EXISTS",
        message: `Research campaign ${parsed.data.campaign_id} already exists`,
      }
    } else if (existing.error_code === "STORAGE_READ_FAILED") {
      outcome = existing
    } else {
      const written = await writeImmutableResearchCampaignRevision({
        campaign_directory: campaignDirectory,
        revision: 0,
        serialized_bytes: JSON.stringify(parsed.data, null, 2),
      }, runtime)
      outcome = written.kind === "ok" ? { kind: "ok", state: parsed.data } : written
    }
  } catch (error) {
    return rethrowAfterResearchCampaignLockCleanup(error, () =>
      releaseResearchCampaignWriteLock({ campaign_directory: campaignDirectory, token: lock.token }, runtime))
  }
  const released = await releaseResearchCampaignWriteLock({ campaign_directory: campaignDirectory, token: lock.token }, runtime)
  if (released.kind === "error" && outcome.kind === "error") {
    return { ...outcome, cleanup_failure: released }
  }
  return released.kind === "error" ? released : outcome
}
