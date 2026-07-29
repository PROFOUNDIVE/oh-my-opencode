import { WorkflowStateV1Schema, type WorkflowStateV1 } from "../state"
import { writeImmutableWorkflowRevision } from "./atomic-writer"
import { nodeStorageRuntime } from "./node-storage-runtime"
import { readWorkflowState } from "./reader"
import { getWorkflowRunDirectory } from "./run-directory-hash"
import type { StorageRuntime } from "./storage-runtime-contract"
import type { WorkflowMutationResult } from "./storage-results"
import { acquireWorkflowWriteLock, releaseWorkflowWriteLock } from "./write-lock"

const MUTATION_LOCK_TIMEOUT_MS = 5_000
const MAX_REVISION = 999_999_999_999

async function commitNextRevision(
  request: {
    readonly directory: string
    readonly run_id: string
    readonly expected_state_revision: number
    readonly next_state: WorkflowStateV1
  },
  runDirectory: string,
  runtime: StorageRuntime,
): Promise<WorkflowMutationResult> {
  const current = await readWorkflowState(request.directory, request.run_id, runtime)
  if (current.kind === "error") return current
  if (current.state.state_revision !== request.expected_state_revision) {
    return {
      kind: "error",
      error_code: "STALE_STATE_REVISION",
      current_state_revision: current.state.state_revision,
      message: `Expected revision ${request.expected_state_revision}, found ${current.state.state_revision}`,
    }
  }
  const revision = current.state.state_revision + 1
  if (revision > MAX_REVISION) {
    return { kind: "error", error_code: "STORAGE_WRITE_FAILED", message: "Workflow revision space is exhausted" }
  }
  const parsed = WorkflowStateV1Schema.safeParse({ ...request.next_state, state_revision: revision })
  if (!parsed.success || parsed.data.run_id !== request.run_id) {
    return { kind: "error", error_code: "STORAGE_WRITE_FAILED", message: "Resulting workflow state is invalid" }
  }
  const written = await writeImmutableWorkflowRevision({ run_directory: runDirectory, revision, state: parsed.data }, runtime)
  return written.kind === "ok" ? { kind: "ok", state: parsed.data } : written
}

export async function compareAndSwapWorkflowState(
  request: {
    readonly directory: string
    readonly run_id: string
    readonly expected_state_revision: number
    readonly next_state: WorkflowStateV1
  },
  runtime: StorageRuntime = nodeStorageRuntime,
): Promise<WorkflowMutationResult> {
  const runDirectory = getWorkflowRunDirectory(request.directory, request.run_id)
  try {
    await runtime.mkdir(runDirectory)
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return { kind: "error", error_code: "STORAGE_WRITE_FAILED", message: "Unable to create workflow run directory" }
  }
  const lock = await acquireWorkflowWriteLock({ run_directory: runDirectory, timeout_ms: MUTATION_LOCK_TIMEOUT_MS }, runtime)
  if (lock.kind === "error") return lock
  const outcome = await commitNextRevision(request, runDirectory, runtime)
  const released = await releaseWorkflowWriteLock({ run_directory: runDirectory, token: lock.token }, runtime)
  return released.kind === "error" ? released : outcome
}
