import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { writeImmutableWorkflowRevision } from "./atomic-writer"
import { getWorkflowRunDirectory } from "./run-directory-hash"
import { getWorkflowRevisionPath } from "./revision-filename"
import { startWorkflowState } from "./start-reservation"
import { createStoredWorkflowState } from "./storage-test-state"

export function registerImmutabilityFailureCases(): void {
  describe("workflow revision immutability", () => {
    let directory: string

    beforeEach(() => {
      directory = mkdtempSync(join(tmpdir(), "openmath-workflow-immutable-"))
    })

    afterEach(() => {
      rmSync(directory, { recursive: true, force: true })
    })

    test("refuses to rename over an allocated revision", async () => {
      // given
      const state = createStoredWorkflowState("immutable-run", 0)
      await startWorkflowState({ directory, state })
      const runDirectory = getWorkflowRunDirectory(directory, state.run_id)
      const revisionPath = getWorkflowRevisionPath(runDirectory, 0)
      const originalBytes = readFileSync(revisionPath, "utf8")

      // when
      const result = await writeImmutableWorkflowRevision({
        run_directory: runDirectory,
        revision: 0,
        state: { ...state, intervention_satisfied: true },
      })

      // then
      expect(result).toMatchObject({ kind: "error", error_code: "STORAGE_WRITE_FAILED" })
      expect(readFileSync(revisionPath, "utf8")).toBe(originalBytes)
      expect(readdirSync(runDirectory).filter((name) => name.startsWith(".tmp-"))).toEqual([])
    })
  })
}
