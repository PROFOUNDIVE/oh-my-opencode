import type { WorkflowStateV1 } from "../state"
import {
  writeImmutableJsonRevision,
  type ImmutableJsonRevisionFailureReason,
} from "../../revision-store/immutable-json-revision-writer"
import { nodeStorageRuntime } from "./node-storage-runtime"
import { getWorkflowRevisionPath } from "./revision-filename"
import type { StorageRuntime } from "./storage-runtime-contract"
import type { AtomicWriteResult } from "./storage-results"

const WORKFLOW_FAILURE_MESSAGES: Readonly<Record<ImmutableJsonRevisionFailureReason, string>> = {
  DURABLE_TEMP_WRITE_FAILED: "Unable to durably write workflow temp file",
  EXCLUSIVE_TEMP_CREATE_UNAVAILABLE: "Exclusive temp creation is unavailable",
  EXCLUSIVE_TEMP_IDENTITY_CHANGED: "Exclusive workflow temp identity changed",
  NO_REPLACE_PUBLICATION_UNAVAILABLE: "Atomic no-replace publication is unavailable",
  OWNED_TEMP_REMOVE_FAILED: "Unable to remove owned workflow temp",
  OWNERSHIP_BOUND_TEMP_CREATE_UNAVAILABLE: "Ownership-bound temp creation is unavailable",
  REVISION_ALREADY_ALLOCATED: "Workflow revision is already allocated",
  REVISION_PUBLICATION_FAILED: "Unable to publish workflow revision",
  RUN_DIRECTORY_CLOSE_FAILED: "Unable to close workflow directory after fsync",
  RUN_DIRECTORY_OPEN_FAILED: "Unable to open workflow directory for fsync",
  RUN_DIRECTORY_SYNC_FAILED: "Unable to fsync workflow directory",
  TEMP_CREATE_FAILED: "Unable to create workflow temp file",
  TEMP_OWNERSHIP_BIND_FAILED: "Unable to bind workflow temp ownership",
  TEMP_OWNERSHIP_BINDING_CHANGED: "Workflow temp ownership binding changed",
  TEMP_OWNERSHIP_CHANGED_BEFORE_PUBLICATION: "Workflow temp ownership changed before publication",
  TEMP_OWNERSHIP_VERIFY_FAILED: "Unable to verify workflow temp ownership",
  TEMP_QUARANTINE_FAILED: "Unable to quarantine workflow temp",
  TEMP_QUARANTINE_UNAVAILABLE: "Atomic temp quarantine is unavailable",
  TEMP_RESTORATION_UNAVAILABLE: "Atomic temp restoration is unavailable",
  TEMP_RESTORE_FAILED: "Unable to restore replacement workflow temp",
}

export async function writeImmutableWorkflowRevision(
  request: { readonly run_directory: string; readonly revision: number; readonly state: WorkflowStateV1 },
  runtime: StorageRuntime = nodeStorageRuntime,
): Promise<AtomicWriteResult> {
  const result = await writeImmutableJsonRevision({
    run_directory: request.run_directory,
    build_revision_path: (runDirectory) => getWorkflowRevisionPath(runDirectory, request.revision),
    serialized_bytes: JSON.stringify(request.state, null, 2),
  }, runtime)
  return result.kind === "ok"
    ? result
    : { kind: "error", error_code: result.error_code, message: WORKFLOW_FAILURE_MESSAGES[result.reason] }
}
