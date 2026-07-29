import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"

import {
  compareAndSwapWorkflowState,
  getWorkflowRunDirectory,
  readWorkflowState,
  startWorkflowState,
} from "../storage"
import { getWorkflowRevisionPath } from "../storage/revision-filename"
import type { WorkflowStateV1 } from "../state"
import { reduceTransition } from "./reduce-transition"
import type { WorkflowTransitionEvent } from "./types"

export const STALE_REVISION_ONE = {
  kind: "error",
  error_code: "STALE_STATE_REVISION",
  current_state_revision: 1,
  message: "Expected revision 0, found 1",
} as const

export async function runTransitionRace(input: {
  readonly directory: string
  readonly initial: WorkflowStateV1
  readonly first_event: WorkflowTransitionEvent
  readonly second_event: WorkflowTransitionEvent
}) {
  await startWorkflowState({ directory: input.directory, state: input.initial })
  const runDirectory = getWorkflowRunDirectory(input.directory, input.initial.run_id)
  const revisionZeroPath = getWorkflowRevisionPath(runDirectory, 0)
  const revisionZeroBytes = readFileSync(revisionZeroPath, "utf8")
  const candidates = [
    changed(input.initial, input.first_event),
    changed(input.initial, input.second_event),
  ] as const
  const candidateBytesBefore = candidates.map((candidate) => JSON.stringify(candidate))
  const outcomes = await Promise.all(candidates.map((nextState) => compareAndSwapWorkflowState({
    directory: input.directory,
    run_id: input.initial.run_id,
    expected_state_revision: input.initial.state_revision,
    next_state: nextState,
  })))
  const persistedResult = await readWorkflowState(input.directory, input.initial.run_id)
  if (persistedResult.kind !== "ok") throw new Error(persistedResult.message)
  const winnerResult = outcomes.find((outcome) => outcome.kind === "ok")
  if (!winnerResult || winnerResult.kind !== "ok") throw new Error("Expected one CAS winner")
  return {
    outcomes,
    persisted: persistedResult.state,
    winner: winnerResult.state,
    candidateBytesBefore,
    candidateBytesAfter: candidates.map((candidate) => JSON.stringify(candidate)),
    revisionZeroPath,
    revisionZeroBytes,
    revisionZeroHash: sha256(revisionZeroBytes),
  }
}

export function changed(state: WorkflowStateV1, event: WorkflowTransitionEvent): WorkflowStateV1 {
  const result = reduceTransition(state, event)
  if (!result.ok) throw new Error(result.message)
  return result.state
}

export function reloadedProfile(state: WorkflowStateV1, modelID: string): WorkflowStateV1["profile_snapshot"] {
  return {
    ...state.profile_snapshot,
    solve: {
      ...state.profile_snapshot.solve,
      model: { ...state.profile_snapshot.solve.model, modelID },
    },
  }
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}
