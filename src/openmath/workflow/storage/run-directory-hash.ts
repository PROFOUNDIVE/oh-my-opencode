import { createHash } from "node:crypto"
import { join } from "node:path"

export function getWorkflowRunDirectory(directory: string, runId: string): string {
  const runHash = createHash("sha256").update(runId, "utf8").digest("hex")
  return join(directory, ".sisyphus", "openmath-workflows", runHash)
}
