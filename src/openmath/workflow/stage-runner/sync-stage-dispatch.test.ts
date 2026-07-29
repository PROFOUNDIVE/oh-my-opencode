import { expect, test } from "bun:test"
import { createOpencodeClient } from "@opencode-ai/sdk"

import { createSyncStageDispatch } from "./sync-stage-dispatch"
import type { StageSubagentDispatch } from "./stage-runner-types"

test("passes the immutable stage snapshot unchanged into the typed sync subagent seam", async () => {
  // given
  let received: Parameters<typeof import("../../../tools/openmath-solve-only/run-sync-subagent").runSyncSubagentText>[0] | undefined
  const dispatch = createSyncStageDispatch({
    client: createOpencodeClient(),
    directory: "/project",
    ctx: { sessionID: "resuming-caller", messageID: "message", agent: "tester", abort: new AbortController().signal },
  }, {
    runSubagent: async (input) => {
      received = input
      return { ok: true, sessionID: "child-1", text: "output" }
    },
  })
  const input: StageSubagentDispatch = {
    parent_session_id: "persisted-parent",
    child_title: `[openmath:${"e".repeat(64)}] solver run-1 round 1`,
    agent_to_use: "solver",
    category_model: { providerID: "openai", modelID: "gpt-5.2", variant: "high" },
    system_content: "immutable system",
    user_prompt: "payload",
    prompt_marker: `OPENMATH_ATTEMPT_KEY: ${"e".repeat(64)}\n`,
    persisted_session_id: "child-1",
    send_prompt: false,
    awaited_callbacks: {},
  }

  // when
  const result = await dispatch(input)

  // then
  expect(result).toEqual({ ok: true, session_id: "child-1", text: "output" })
  expect(received).toMatchObject({
    parentSessionID: "persisted-parent",
    persistedSessionID: "child-1",
    skipPrompt: true,
    childTitle: input.child_title,
    promptMarker: input.prompt_marker,
    categoryModel: input.category_model,
    systemContent: "immutable system",
  })
})
