import { expect, test } from "bun:test"

import { WorkflowStateV1Schema, type WorkflowStateV1 } from "../state"
import { runWorkflowStage, type StageRunnerRuntime, type StageSubagentDispatch } from "./run-workflow-stage"
import { runningWorkflowState } from "./test-fixture"

test("persists and commits one SOLVE attempt with the exact immutable dispatch snapshot", async () => {
  // given
  const initialState = runningWorkflowState("SOLVE")
  const initialStageHistoryCount = initialState.stage_history.length
  let persistedState: WorkflowStateV1 = initialState
  const phases: string[] = []
  const dispatches: StageSubagentDispatch[] = []
  const runtime: StageRunnerRuntime = {
    persist: async (nextState: WorkflowStateV1) => {
      const state = nextState.state_revision === persistedState.state_revision
        ? WorkflowStateV1Schema.parse({ ...nextState, state_revision: nextState.state_revision + 1 })
        : nextState
      persistedState = state
      phases.push(lastAttempt(state)?.phase ?? "")
      return state
    },
    list_children: async () => [],
    get_session: async () => ({ title: "" }),
    list_messages: async () => {
      const attempt = lastAttempt(persistedState)
      if (!attempt || !("child_session_id" in attempt)) return []
      return [{ role: "user", text: `OPENMATH_ATTEMPT_KEY: ${attempt.idempotency_key}\npayload` }]
    },
    dispatch: async (input) => {
      dispatches.push(input)
      await input.awaited_callbacks.on_session_created?.("child-solve")
      await input.awaited_callbacks.on_prompt_sent?.("child-solve")
      return { ok: true as const, session_id: "child-solve", text: "# Solved artifact\n" }
    },
  }

  // when
  const result = await runWorkflowStage({
    state: initialState,
    workflow_input: "prove the theorem",
    runtime,
  })

  // then
  expect(phases).toEqual(["PREPARED", "SESSION_CREATED", "PROMPT_SENT", "COMPLETED", "COMMITTED"])
  expect(dispatches).toHaveLength(1)
  const [dispatch] = dispatches
  if (!dispatch) throw new TypeError("Expected one stage dispatch")
  expect(dispatch).toMatchObject({
    parent_session_id: "parent-session-immutable",
    child_title: expect.stringMatching(/^\[openmath:[a-f0-9]{64}\] solver run-1 round 1$/),
    prompt_marker: expect.stringMatching(/^OPENMATH_ATTEMPT_KEY: [a-f0-9]{64}\n$/),
    category_model: { providerID: "openai", modelID: "gpt-5.2", variant: "high" },
    system_content: "solve system",
    send_prompt: true,
  })
  expect(result.status).toBe("READY")
  expect(result.stage_history).toHaveLength(initialStageHistoryCount + 1)
})

function lastAttempt(state: WorkflowStateV1) {
  return state.dispatch_attempts[state.dispatch_attempts.length - 1]
}
