import { join } from "node:path"

import { nodeStorageRuntime } from "../../workflow/storage/node-storage-runtime"
import type { StorageRuntime } from "../../workflow/storage/storage-runtime-contract"
import { parseResearchCampaignStateV1Json } from "../state"
import { getResearchCampaignDirectory } from "./campaign-directory-hash"
import { getFilesystemErrorCode } from "./filesystem-error-code"
import { parseResearchCampaignRevisionFilename } from "./revision-filename"
import type { ResearchCampaignReadResult } from "./storage-results"

export async function readResearchCampaignState(
  directory: string,
  campaignId: string,
  runtime: StorageRuntime = nodeStorageRuntime,
): Promise<ResearchCampaignReadResult> {
  const campaignDirectory = getResearchCampaignDirectory(directory, campaignId)
  let filenames: readonly string[]
  try {
    filenames = await runtime.readdir(campaignDirectory)
  } catch (error) {
    if (getFilesystemErrorCode(error) === "ENOENT") {
      return { kind: "error", error_code: "CAMPAIGN_NOT_FOUND", message: `Research campaign ${campaignId} was not found` }
    }
    return { kind: "error", error_code: "STORAGE_READ_FAILED", message: `Unable to list research campaign ${campaignId}` }
  }

  const allocations = filenames
    .map((filename) => ({ filename, revision: parseResearchCampaignRevisionFilename(filename) }))
    .filter((allocation): allocation is { readonly filename: string; readonly revision: number } => allocation.revision !== null)
    .sort((left, right) => right.revision - left.revision)
  const highest = allocations[0]
  if (highest === undefined) {
    return { kind: "error", error_code: "CAMPAIGN_NOT_FOUND", message: `Research campaign ${campaignId} has no revision` }
  }

  let content: string
  try {
    content = await runtime.readFile(join(campaignDirectory, highest.filename))
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return { kind: "error", error_code: "STORAGE_READ_FAILED", message: "Highest research campaign revision is unreadable" }
  }
  const parsed = parseResearchCampaignStateV1Json(content)
  if (parsed.kind === "error") return parsed
  if (parsed.state.campaign_id !== campaignId || parsed.state.state_revision !== highest.revision) {
    return {
      kind: "error",
      error_code: "STORAGE_READ_FAILED",
      message: "Research campaign revision identity does not match its allocation",
    }
  }
  return parsed
}
