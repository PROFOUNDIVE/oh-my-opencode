import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { compareAndSwapWorkflowState, getWorkflowRunDirectory, readWorkflowState, startWorkflowState } from "../storage"
import { getWorkflowRevisionPath } from "../storage/revision-filename"
import type { WorkflowTransitionEvent } from "./index"
import {
  changed,
  reloadedProfile,
  runTransitionRace,
  sha256,
  STALE_REVISION_ONE,
} from "./cas-race-test-fixture"
import { artifact, runningWithReceipt, workflowState } from "./test-fixture"

describe("workflow transition CAS races", () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "openmath-transition-race-"))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  test.each([
    [
      "amend",
      {
        type: "ADD_AMENDMENT",
        kind: "question",
        scope: "all_remaining",
        content: "candidate-a",
      },
      {
        type: "ADD_AMENDMENT",
        kind: "required_check",
        scope: "all_remaining",
        content: "candidate-b",
      },
    ],
    [
      "abort",
      { type: "ABORT", reason: "candidate-a" },
      { type: "ABORT", reason: "candidate-b" },
    ],
  ] satisfies readonly (readonly [string, WorkflowTransitionEvent, WorkflowTransitionEvent])[])(
    "commits one %s revision and leaves the stale candidate unchanged",
    async (_, firstEvent, secondEvent) => {
      // given
      const initial = workflowState({ run_id: `race-${crypto.randomUUID()}` })

      // when
      const result = await runTransitionRace({
        directory,
        initial,
        first_event: firstEvent,
        second_event: secondEvent,
      })

      // then
      expect(result.outcomes.filter((outcome) => outcome.kind === "ok")).toHaveLength(1)
      expect(result.outcomes.filter((outcome) => outcome.kind === "error")).toEqual([STALE_REVISION_ONE])
      expect(result.persisted.state_revision).toBe(1)
      expect(result.persisted).toEqual(result.winner)
      expect(result.candidateBytesAfter).toEqual(result.candidateBytesBefore)
      expect(readFileSync(result.revisionZeroPath, "utf8")).toBe(result.revisionZeroBytes)
      expect(sha256(readFileSync(result.revisionZeroPath, "utf8"))).toBe(result.revisionZeroHash)
    },
  )

  test("commits exactly one reload snapshot", async () => {
    // given
    const initial = workflowState({ run_id: `reload-${crypto.randomUUID()}` })
    const first = reloadedProfile(initial, "candidate-a")
    const second = reloadedProfile(initial, "candidate-b")

    // when
    const result = await runTransitionRace({
      directory,
      initial,
      first_event: { type: "RELOAD", profile_snapshot: first },
      second_event: { type: "RELOAD", profile_snapshot: second },
    })

    // then
    expect(result.outcomes.filter((outcome) => outcome.kind === "ok")).toHaveLength(1)
    expect(result.outcomes.filter((outcome) => outcome.kind === "error")).toEqual([STALE_REVISION_ONE])
    expect(result.persisted.state_revision).toBe(1)
    expect(result.persisted).toEqual(result.winner)
    expect(result.candidateBytesAfter).toEqual(result.candidateBytesBefore)
    expect(readFileSync(result.revisionZeroPath, "utf8")).toBe(result.revisionZeroBytes)
    expect(sha256(readFileSync(result.revisionZeroPath, "utf8"))).toBe(result.revisionZeroHash)
    expect(["candidate-a", "candidate-b"]).toContain(result.persisted.profile_snapshot.solve.model.modelID)
  })

  test("suppresses a stale receipt after abort wins CAS", async () => {
    // given
    const initial = runningWithReceipt(
      workflowState({ run_id: `abort-receipt-${crypto.randomUUID()}` }),
      "SOLVE",
      { kind: "ARTIFACT", artifact: artifact() },
    )
    await startWorkflowState({ directory, state: initial })
    const abort = changed(initial, { type: "ABORT", reason: "stop" })
    const receipt = changed(initial, { type: "COMMIT_STAGE_RECEIPT" })
    const candidatesBefore = [JSON.stringify(abort), JSON.stringify(receipt)]
    const revisionZeroPath = getWorkflowRevisionPath(getWorkflowRunDirectory(directory, initial.run_id), 0)
    const revisionZeroBytes = readFileSync(revisionZeroPath, "utf8")
    const revisionZeroHash = sha256(revisionZeroBytes)

    // when
    const abortWinner = await compareAndSwapWorkflowState({
      directory,
      run_id: initial.run_id,
      expected_state_revision: 0,
      next_state: abort,
    })
    const staleReceipt = await compareAndSwapWorkflowState({
      directory,
      run_id: initial.run_id,
      expected_state_revision: 0,
      next_state: receipt,
    })
    const afterAbort = await readWorkflowState(directory, initial.run_id)
    if (afterAbort.kind !== "ok") throw new Error(afterAbort.message)
    const suppressed = changed(afterAbort.state, { type: "COMMIT_STAGE_RECEIPT" })
    const committed = await compareAndSwapWorkflowState({
      directory,
      run_id: initial.run_id,
      expected_state_revision: 1,
      next_state: suppressed,
    })

    // then
    expect(abortWinner).toMatchObject({ kind: "ok", state: { state_revision: 1, abort_requested: true } })
    expect(staleReceipt).toEqual(STALE_REVISION_ONE)
    expect([JSON.stringify(abort), JSON.stringify(receipt)]).toEqual(candidatesBefore)
    expect(readFileSync(revisionZeroPath, "utf8")).toBe(revisionZeroBytes)
    expect(sha256(readFileSync(revisionZeroPath, "utf8"))).toBe(revisionZeroHash)
    expect(committed).toMatchObject({
      kind: "ok",
      state: { state_revision: 2, status: "ABORTED", artifact: null },
    })
  })
})
