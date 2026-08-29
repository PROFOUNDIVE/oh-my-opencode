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
    tool_policy: "deny_all",
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
    tool_policy: "deny_all",
  })
})

test("forwards a falsey malformed policy to the fail-closed sender", async () => {
  // given
  const source = falseyPolicyDriverSource()

  // when
  const child = Bun.spawn(["bun", "-e", source], { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])

  // then
  if (exitCode !== 0) throw new Error(stderr)
  expect(stdout.trim()).toBe("forwarded-empty")
})

function falseyPolicyDriverSource(): string {
  return `
    import { createOpencodeClient } from "@opencode-ai/sdk";
    import { createSyncStageDispatch } from "./src/openmath/workflow/stage-runner/sync-stage-dispatch.ts";

    const dispatch = createSyncStageDispatch({
      client: createOpencodeClient(),
      directory: "/project",
      ctx: { sessionID: "caller", messageID: "message", agent: "tester", abort: new AbortController().signal },
    }, {
      runSubagent: async (input) => {
        console.log(input.tool_policy === "" ? "forwarded-empty" : "missing");
        return { ok: true, sessionID: "child-1", text: "output" };
      },
    });
    await dispatch({
      parent_session_id: "parent",
      child_title: "candidate",
      agent_to_use: "solver",
      category_model: { providerID: "openai", modelID: "gpt-5.2" },
      system_content: undefined,
      user_prompt: "payload",
      prompt_marker: "marker",
      persisted_session_id: undefined,
      send_prompt: true,
      tool_policy: "",
      awaited_callbacks: {},
    });
  `
}
