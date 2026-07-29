import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { getWorkflowRunDirectory } from "./run-directory-hash"
import { readWorkflowState } from "./reader"
import { getWorkflowRevisionPath } from "./revision-filename"
import { createStoredWorkflowState } from "./storage-test-state"

describe("workflow revision reader", () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "openmath-workflow-reader-"))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  test("ignores interrupted temps and returns the highest allocated numeric revision", async () => {
    // given
    const runId = "reader-run"
    const runDirectory = getWorkflowRunDirectory(directory, runId)
    mkdirSync(runDirectory, { recursive: true })
    writeFileSync(getWorkflowRevisionPath(runDirectory, 0), JSON.stringify(createStoredWorkflowState(runId, 0)))
    writeFileSync(getWorkflowRevisionPath(runDirectory, 4), JSON.stringify(createStoredWorkflowState(runId, 4)))
    writeFileSync(join(runDirectory, ".tmp-state.rev-999999999999.json"), "{corrupt")

    // when
    const result = await readWorkflowState(directory, runId)

    // then
    expect(result).toMatchObject({ kind: "ok", state: { run_id: runId, state_revision: 4 } })
  })

  test("fails closed when the highest allocated revision is corrupt or unsupported", async () => {
    // given
    const runId = "corrupt-highest"
    const runDirectory = getWorkflowRunDirectory(directory, runId)
    mkdirSync(runDirectory, { recursive: true })
    writeFileSync(getWorkflowRevisionPath(runDirectory, 1), JSON.stringify(createStoredWorkflowState(runId, 1)))
    writeFileSync(getWorkflowRevisionPath(runDirectory, 2), "{corrupt")

    // when
    const corrupt = await readWorkflowState(directory, runId)
    writeFileSync(getWorkflowRevisionPath(runDirectory, 2), JSON.stringify({
      ...createStoredWorkflowState(runId, 2),
      schema_version: 2,
    }))
    const unsupported = await readWorkflowState(directory, runId)

    // then
    expect(corrupt).toMatchObject({ kind: "error", error_code: "STORAGE_READ_FAILED" })
    expect(unsupported).toMatchObject({ kind: "error", error_code: "STORAGE_READ_FAILED" })
  })

  test("rejects a highest revision whose persisted run ID or revision does not match its allocation", async () => {
    // given
    const runId = "requested-run"
    const runDirectory = getWorkflowRunDirectory(directory, runId)
    mkdirSync(runDirectory, { recursive: true })
    writeFileSync(getWorkflowRevisionPath(runDirectory, 3), JSON.stringify(createStoredWorkflowState("other-run", 3)))

    // when
    const wrongRun = await readWorkflowState(directory, runId)
    writeFileSync(getWorkflowRevisionPath(runDirectory, 3), JSON.stringify(createStoredWorkflowState(runId, 2)))
    const wrongRevision = await readWorkflowState(directory, runId)

    // then
    expect(wrongRun).toMatchObject({ kind: "error", error_code: "STORAGE_READ_FAILED" })
    expect(wrongRevision).toMatchObject({ kind: "error", error_code: "STORAGE_READ_FAILED" })
  })

  test("returns RUN_NOT_FOUND when no numeric revision is allocated", async () => {
    // when
    const result = await readWorkflowState(directory, "missing-run")

    // then
    expect(result).toMatchObject({ kind: "error", error_code: "RUN_NOT_FOUND" })
  })
})
