import {
  writeImmutableJsonRevision,
  type ImmutableJsonRevisionFailureReason,
} from "../../revision-store/immutable-json-revision-writer"
import { nodeStorageRuntime } from "../../workflow/storage/node-storage-runtime"
import type { StorageRuntime } from "../../workflow/storage/storage-runtime-contract"
import { getResearchCampaignRevisionPath } from "./revision-filename"
import type { ResearchCampaignAtomicWriteResult } from "./storage-results"

const CAMPAIGN_FAILURE_MESSAGES: Readonly<Record<ImmutableJsonRevisionFailureReason, string>> = {
  DURABLE_TEMP_WRITE_FAILED: "Unable to durably write research campaign temp file",
  EXCLUSIVE_TEMP_CREATE_UNAVAILABLE: "Exclusive research campaign temp creation is unavailable",
  EXCLUSIVE_TEMP_IDENTITY_CHANGED: "Exclusive research campaign temp identity changed",
  NO_REPLACE_PUBLICATION_UNAVAILABLE: "Atomic research campaign no-replace publication is unavailable",
  OWNED_TEMP_REMOVE_FAILED: "Unable to remove owned research campaign temp",
  OWNERSHIP_BOUND_TEMP_CREATE_UNAVAILABLE: "Ownership-bound research campaign temp creation is unavailable",
  REVISION_ALREADY_ALLOCATED: "Research campaign revision is already allocated",
  REVISION_PUBLICATION_FAILED: "Unable to publish research campaign revision",
  RUN_DIRECTORY_CLOSE_FAILED: "Unable to close research campaign directory after fsync",
  RUN_DIRECTORY_OPEN_FAILED: "Unable to open research campaign directory for fsync",
  RUN_DIRECTORY_SYNC_FAILED: "Unable to fsync research campaign directory",
  TEMP_CREATE_FAILED: "Unable to create research campaign temp file",
  TEMP_OWNERSHIP_BIND_FAILED: "Unable to bind research campaign temp ownership",
  TEMP_OWNERSHIP_BINDING_CHANGED: "Research campaign temp ownership binding changed",
  TEMP_OWNERSHIP_CHANGED_BEFORE_PUBLICATION: "Research campaign temp ownership changed before publication",
  TEMP_OWNERSHIP_VERIFY_FAILED: "Unable to verify research campaign temp ownership",
  TEMP_QUARANTINE_FAILED: "Unable to quarantine research campaign temp",
  TEMP_QUARANTINE_UNAVAILABLE: "Atomic research campaign temp quarantine is unavailable",
  TEMP_RESTORATION_UNAVAILABLE: "Atomic research campaign temp restoration is unavailable",
  TEMP_RESTORE_FAILED: "Unable to restore replacement research campaign temp",
}

export async function writeImmutableResearchCampaignRevision(
  request: { readonly campaign_directory: string; readonly revision: number; readonly serialized_bytes: string },
  runtime: StorageRuntime = nodeStorageRuntime,
): Promise<ResearchCampaignAtomicWriteResult> {
  const result = await writeImmutableJsonRevision({
    run_directory: request.campaign_directory,
    build_revision_path: (campaignDirectory) => getResearchCampaignRevisionPath(campaignDirectory, request.revision),
    serialized_bytes: request.serialized_bytes,
  }, runtime)
  return result.kind === "ok"
    ? result
    : { kind: "error", error_code: result.error_code, message: CAMPAIGN_FAILURE_MESSAGES[result.reason] }
}
