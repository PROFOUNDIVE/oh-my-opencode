import { nodeStorageRuntime } from "../../workflow/storage/node-storage-runtime"
import type { StorageRuntime } from "../../workflow/storage/storage-runtime-contract"
import { ResearchCampaignStateV1Schema, type ResearchCampaignStateV1 } from "../state"
import { getResearchCampaignDirectory } from "./campaign-directory-hash"
import { writeImmutableResearchCampaignRevision } from "./immutable-revision-writer"
import { readResearchCampaignState } from "./reader"
import type { ResearchCampaignMutationResult, ResearchCampaignWriteLockReleaseResult } from "./storage-results"
import { acquireResearchCampaignWriteLock, releaseResearchCampaignWriteLock } from "./write-lock"
import { rethrowAfterResearchCampaignLockCleanup } from "./lock-cleanup-error"

const MUTATION_LOCK_TIMEOUT_MS = 5_000
const MAX_REVISION = 999_999_999_999

type ResearchCampaignMutationResultWithCleanup = ResearchCampaignMutationResult | (Extract<ResearchCampaignMutationResult, { readonly kind: "error" }> & {
  readonly cleanup_failure: Extract<ResearchCampaignWriteLockReleaseResult, { readonly kind: "error" }>
})

type ResearchCampaignCasRequest = {
  readonly directory: string
  readonly campaign_id: string
  readonly expected_state_revision: number
  readonly next_state: ResearchCampaignStateV1
}

async function commitNextRevision(
  request: ResearchCampaignCasRequest,
  campaignDirectory: string,
  runtime: StorageRuntime,
): Promise<ResearchCampaignMutationResultWithCleanup> {
  const current = await readResearchCampaignState(request.directory, request.campaign_id, runtime)
  if (current.kind === "error") return current
  if (current.state.state_revision !== request.expected_state_revision) {
    return {
      kind: "error",
      error_code: "STALE_STATE_REVISION",
      current_state_revision: current.state.state_revision,
      message: `Expected research campaign revision ${request.expected_state_revision}, found ${current.state.state_revision}`,
    }
  }
  if (current.state.dossier !== null
    && JSON.stringify(request.next_state.dossier) !== JSON.stringify(current.state.dossier)) {
    return { kind: "error", error_code: "STORAGE_WRITE_FAILED", message: "Promotion dossier is immutable after readiness" }
  }
  const revision = current.state.state_revision + 1
  if (revision > MAX_REVISION) {
    return { kind: "error", error_code: "STORAGE_WRITE_FAILED", message: "Research campaign revision space is exhausted" }
  }
  const parsed = ResearchCampaignStateV1Schema.safeParse({ ...request.next_state, state_revision: revision })
  if (!parsed.success || parsed.data.campaign_id !== request.campaign_id) {
    return { kind: "error", error_code: "STORAGE_WRITE_FAILED", message: "Resulting research campaign state is invalid" }
  }
  const written = await writeImmutableResearchCampaignRevision({
    campaign_directory: campaignDirectory,
    revision,
    serialized_bytes: JSON.stringify(parsed.data, null, 2),
  }, runtime)
  return written.kind === "ok" ? { kind: "ok", state: parsed.data } : written
}

export async function compareAndSwapResearchCampaignState(
  request: ResearchCampaignCasRequest,
  runtime: StorageRuntime = nodeStorageRuntime,
): Promise<ResearchCampaignMutationResultWithCleanup> {
  const campaignDirectory = getResearchCampaignDirectory(request.directory, request.campaign_id)
  try {
    await runtime.mkdir(campaignDirectory)
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return { kind: "error", error_code: "STORAGE_WRITE_FAILED", message: "Unable to create research campaign directory" }
  }
  const lock = await acquireResearchCampaignWriteLock({
    campaign_directory: campaignDirectory,
    timeout_ms: MUTATION_LOCK_TIMEOUT_MS,
  }, runtime)
  if (lock.kind === "error") return lock
  let outcome: ResearchCampaignMutationResult
  try {
    outcome = await commitNextRevision(request, campaignDirectory, runtime)
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
