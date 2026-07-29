import { WorkflowStateV1Schema, type WorkflowStateV1 } from "../state"
import { writeImmutableWorkflowRevision } from "./atomic-writer"
import { nodeStorageRuntime } from "./node-storage-runtime"
import { readWorkflowState } from "./reader"
import { getWorkflowRunDirectory } from "./run-directory-hash"
import type { StorageRuntime } from "./storage-runtime-contract"
import type { WorkflowMutationResult } from "./storage-results"
import { acquireWorkflowWriteLock, releaseWorkflowWriteLock } from "./write-lock"

const START_LOCK_TIMEOUT_MS = 30_000

async function reserveRevisionZero(
  directory: string,
  state: WorkflowStateV1,
  runDirectory: string,
  runtime: StorageRuntime,
): Promise<WorkflowMutationResult> {
  const existing = await readWorkflowState(directory, state.run_id, runtime)
  if (existing.kind === "ok") {
    return { kind: "error", error_code: "RUN_ALREADY_EXISTS", message: `Workflow run ${state.run_id} already exists` }
  }
  if (existing.error_code === "STORAGE_READ_FAILED") return existing
  const written = await writeImmutableWorkflowRevision({ run_directory: runDirectory, revision: 0, state }, runtime)
  return written.kind === "ok" ? { kind: "ok", state } : written
}

export async function startWorkflowState(
  request: { readonly directory: string; readonly state: WorkflowStateV1 },
  runtime: StorageRuntime = nodeStorageRuntime,
): Promise<WorkflowMutationResult> {
  const parsed = WorkflowStateV1Schema.safeParse(request.state)
  if (!parsed.success || parsed.data.state_revision !== 0) {
    return { kind: "error", error_code: "STORAGE_WRITE_FAILED", message: "Initial workflow state must be strict revision zero" }
  }
  const runDirectory = getWorkflowRunDirectory(request.directory, parsed.data.run_id)
  try {
    await runtime.mkdir(runDirectory)
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return { kind: "error", error_code: "STORAGE_WRITE_FAILED", message: "Unable to create workflow run directory" }
  }
  const lock = await acquireWorkflowWriteLock({ run_directory: runDirectory, timeout_ms: START_LOCK_TIMEOUT_MS }, runtime)
  if (lock.kind === "error") {
    if (lock.error_code !== "STORAGE_BUSY") return lock
    const allocated = await readWorkflowState(request.directory, parsed.data.run_id, runtime)
    if (allocated.kind === "ok") {
      return { kind: "error", error_code: "RUN_ALREADY_EXISTS", message: `Workflow run ${parsed.data.run_id} already exists` }
    }
    return allocated.error_code === "STORAGE_READ_FAILED" ? allocated : lock
  }

  const outcome = await reserveRevisionZero(request.directory, parsed.data, runDirectory, runtime)
  const released = await releaseWorkflowWriteLock({ run_directory: runDirectory, token: lock.token }, runtime)
  return released.kind === "error" ? released : outcome
}
