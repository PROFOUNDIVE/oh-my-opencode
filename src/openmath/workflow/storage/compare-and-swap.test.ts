import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { compareAndSwapWorkflowState } from "./compare-and-swap"
import { getWorkflowRunDirectory } from "./run-directory-hash"
import { getWorkflowRevisionPath } from "./revision-filename"
import { startWorkflowState } from "./start-reservation"
import { createStoredWorkflowState } from "./storage-test-state"

describe("workflow compare and swap", () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "openmath-workflow-cas-"))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  test("rereads under lock, increments once, and preserves immutable prior bytes", async () => {
    // given
    const runId = "cas-run"
    const initial = createStoredWorkflowState(runId, 0)
    await startWorkflowState({ directory, state: initial })
    const runDirectory = getWorkflowRunDirectory(directory, runId)
    const revisionZero = getWorkflowRevisionPath(runDirectory, 0)
    const priorBytes = readFileSync(revisionZero, "utf8")
    const nextState = { ...initial, intervention_satisfied: true }

    // when
    const winner = await compareAndSwapWorkflowState({
      directory,
      run_id: runId,
      expected_state_revision: 0,
      next_state: nextState,
    })
    const loser = await compareAndSwapWorkflowState({
      directory,
      run_id: runId,
      expected_state_revision: 0,
      next_state: nextState,
    })

    // then
    expect(winner).toMatchObject({ kind: "ok", state: { state_revision: 1, intervention_satisfied: true } })
    expect(loser).toMatchObject({
      kind: "error",
      error_code: "STALE_STATE_REVISION",
      current_state_revision: 1,
    })
    expect(readFileSync(revisionZero, "utf8")).toBe(priorBytes)
    expect(JSON.parse(readFileSync(getWorkflowRevisionPath(runDirectory, 1), "utf8"))).toMatchObject({
      state_revision: 1,
      intervention_satisfied: true,
    })
  })
})
