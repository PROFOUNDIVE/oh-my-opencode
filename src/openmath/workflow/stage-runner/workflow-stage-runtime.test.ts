import { expect, test } from "bun:test"
import { createOpencodeClient } from "@opencode-ai/sdk"

import { WorkflowStateV1Schema } from "../state"
import { createWorkflowStageRuntime } from "./workflow-stage-runtime"
import { runningWorkflowState } from "./test-fixture"

test("uses storage CAS as the only persisted stage-state authority", async () => {
  // given
  const state = runningWorkflowState("SOLVE")
  let expectedRevision: number | undefined
  const runtime = createWorkflowStageRuntime({
    state,
    directory: "/project",
    client: createOpencodeClient(),
    ctx: { sessionID: "resuming-caller", messageID: "message", agent: "tester", abort: new AbortController().signal },
  }, {
    compareAndSwap: async (request) => {
      expectedRevision = request.expected_state_revision
      return {
        kind: "ok" as const,
        state: WorkflowStateV1Schema.parse({ ...request.next_state, state_revision: request.expected_state_revision + 1 }),
      }
    },
  })

  // when
  const persisted = await runtime.persist(state)

  // then
  expect(expectedRevision).toBe(7)
  expect(persisted.state_revision).toBe(8)
})
