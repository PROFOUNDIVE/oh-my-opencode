import { expect, test } from "bun:test"

import { WorkflowStateV1Schema, type WorkflowStateV1 } from "../state"
import { runWorkflowStep } from "./run-workflow-step"
import type { StageRunnerRuntime } from "./stage-runner-types"
import { runningWorkflowState } from "./test-fixture"

test("one-stage mode commits exactly one stage even when the next stage is READY", async () => {
  // given
  const fixture = readySolveState("none")
  const runtime = stageRuntime(fixture)

  // when
  const result = await runWorkflowStep({ state: fixture, workflow_input: "prove the theorem", mode: "one_stage", runtime })

  // then
  expect(result.status).toBe("READY")
  expect(result.next_stage).toBe("REVIEW")
  expect(runtime.dispatch_count).toBe(1)
})

test("to-checkpoint mode stops after the configured checkpoint", async () => {
  // given
  const fixture = readySolveState("after_solve")
  const runtime = stageRuntime(fixture)

  // when
  const result = await runWorkflowStep({ state: fixture, workflow_input: "prove the theorem", mode: "to_checkpoint", runtime })

  // then
  expect(result.status).toBe("AWAITING_HUMAN")
  expect(result.awaiting_reason).toBe("CHECKPOINT")
  expect(runtime.dispatch_count).toBe(1)
})

function readySolveState(checkpoint: "none" | "after_solve"): WorkflowStateV1 {
  const state = runningWorkflowState("SOLVE")
  return WorkflowStateV1Schema.parse({
    ...state,
    status: "READY",
    awaiting_reason: null,
    abort_requested: false,
    abort_reason: null,
    blocked_reason: null,
    intervention_satisfied: false,
    profile_snapshot: { ...state.profile_snapshot, checkpoint },
  })
}

function stageRuntime(initialState: WorkflowStateV1): StageRunnerRuntime & { readonly dispatch_count: number } {
  let state = initialState
  let dispatchCount = 0
  return {
    get dispatch_count() {
      return dispatchCount
    },
    persist: async (nextState) => {
      const persisted = nextState.state_revision > state.state_revision
        ? nextState
        : WorkflowStateV1Schema.parse({ ...nextState, state_revision: state.state_revision + 1 })
      state = persisted
      return state
    },
    list_children: async () => [],
    get_session: async () => ({ title: "" }),
    list_messages: async () => {
      const attempt = state.dispatch_attempts[state.dispatch_attempts.length - 1]
      if (!attempt || !("child_session_id" in attempt)) return []
      return [{ role: "user", text: `OPENMATH_ATTEMPT_KEY: ${attempt.idempotency_key}\npayload` }]
    },
    dispatch: async (input) => {
      dispatchCount += 1
      await input.awaited_callbacks.on_session_created?.("child-solve")
      await input.awaited_callbacks.on_prompt_sent?.("child-solve")
      return { ok: true, session_id: "child-solve", text: "# Solved artifact\n" }
    },
  }
}
