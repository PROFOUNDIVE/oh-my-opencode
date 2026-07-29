import { join } from "node:path"

const REVISION_FILENAME = /^state\.rev-([0-9]{12})\.json$/
const MAX_REVISION = 999_999_999_999

export function formatWorkflowRevisionFilename(revision: number): string {
  if (!Number.isSafeInteger(revision) || revision < 0 || revision > MAX_REVISION) {
    throw new RangeError("Workflow storage revision must fit twelve decimal digits")
  }
  return `state.rev-${revision.toString().padStart(12, "0")}.json`
}

export function parseWorkflowRevisionFilename(filename: string): number | null {
  const match = REVISION_FILENAME.exec(filename)
  return match?.[1] === undefined ? null : Number(match[1])
}

export function getWorkflowRevisionPath(runDirectory: string, revision: number): string {
  return join(runDirectory, formatWorkflowRevisionFilename(revision))
}
