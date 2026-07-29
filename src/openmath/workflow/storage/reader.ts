import { join } from "node:path"

import { parseWorkflowStateV1Json } from "../state"
import { nodeStorageRuntime } from "./node-storage-runtime"
import { parseWorkflowRevisionFilename } from "./revision-filename"
import { getWorkflowRunDirectory } from "./run-directory-hash"
import type { StorageRuntime } from "./storage-runtime-contract"
import type { WorkflowReadResult } from "./storage-results"

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined
  return typeof error.code === "string" ? error.code : undefined
}

export async function readWorkflowState(
  directory: string,
  runId: string,
  runtime: StorageRuntime = nodeStorageRuntime,
): Promise<WorkflowReadResult> {
  const runDirectory = getWorkflowRunDirectory(directory, runId)
  let filenames: readonly string[]
  try {
    filenames = await runtime.readdir(runDirectory)
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return { kind: "error", error_code: "RUN_NOT_FOUND", message: `Workflow run ${runId} was not found` }
    }
    return { kind: "error", error_code: "STORAGE_READ_FAILED", message: `Unable to list workflow run ${runId}` }
  }

  const allocations = filenames
    .map((filename) => ({ filename, revision: parseWorkflowRevisionFilename(filename) }))
    .filter((allocation): allocation is { readonly filename: string; readonly revision: number } => (
      allocation.revision !== null
    ))
    .sort((left, right) => right.revision - left.revision)
  const highest = allocations[0]
  if (!highest) {
    return { kind: "error", error_code: "RUN_NOT_FOUND", message: `Workflow run ${runId} has no revision` }
  }

  let content: string
  try {
    content = await runtime.readFile(join(runDirectory, highest.filename))
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return { kind: "error", error_code: "STORAGE_READ_FAILED", message: "Highest workflow revision is unreadable" }
  }
  const parsed = parseWorkflowStateV1Json(content)
  if (parsed.kind === "error") return parsed
  if (parsed.state.run_id !== runId || parsed.state.state_revision !== highest.revision) {
    return { kind: "error", error_code: "STORAGE_READ_FAILED", message: "Workflow revision identity does not match its allocation" }
  }
  return parsed
}
