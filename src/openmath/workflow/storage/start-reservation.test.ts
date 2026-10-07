import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { getWorkflowRunDirectory } from "./run-directory-hash"
import { getWorkflowRevisionPath } from "./revision-filename"
import { nodeStorageRuntime } from "./node-storage-runtime"
import { startWorkflowState } from "./start-reservation"
import type { StorageRuntime } from "./storage-runtime-contract"
import { createStoredWorkflowState } from "./storage-test-state"

function fault(code: string): Error & { readonly code: string } {
  return Object.assign(new Error(`Injected ${code}`), { code })
}

describe("workflow start reservation", () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "openmath-workflow-start-"))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  test("reserves revision zero once and never overwrites it", async () => {
    // given
    const state = createStoredWorkflowState("start-run", 0)

    // when
    const first = await startWorkflowState({ directory, state })
    const runDirectory = getWorkflowRunDirectory(directory, state.run_id)
    const revisionPath = getWorkflowRevisionPath(runDirectory, 0)
    const reservedBytes = readFileSync(revisionPath, "utf8")
    const second = await startWorkflowState({ directory, state })

    // then
    expect(first).toMatchObject({ kind: "ok", state: { state_revision: 0 } })
    expect(second).toMatchObject({ kind: "error", error_code: "RUN_ALREADY_EXISTS" })
    expect(existsSync(revisionPath)).toBe(true)
    expect(readFileSync(revisionPath, "utf8")).toBe(reservedBytes)
  })

  test("reports unsupported ownership hard links as unavailable atomicity", async () => {
    // given
    const state = createStoredWorkflowState("unsupported-ownership-link", 0)
    const runtime: StorageRuntime = {
      ...nodeStorageRuntime,
      link: async () => { throw fault("EPERM") },
    }

    // when
    const result = await startWorkflowState({ directory, state }, runtime)

    // then
    expect(result).toEqual({
      kind: "error",
      error_code: "STORAGE_ATOMICITY_UNAVAILABLE",
      message: "Ownership-bound temp creation is unavailable",
    })
    const runDirectory = getWorkflowRunDirectory(directory, state.run_id)
    expect(existsSync(getWorkflowRevisionPath(runDirectory, 0))).toBe(false)
  })
})
