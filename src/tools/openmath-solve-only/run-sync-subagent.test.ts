import { expect, test } from "bun:test"

test("persists the exact titled and marked sync dispatch callbacks", async () => {
  // given
  const source = syncDriverSource(false)

  // when
  const result = await runIsolatedDriver(source)

  // then
  expect(result).toBe("created-and-prompted")
})

test("resumes a persisted prompt receipt without creating or sending another prompt", async () => {
  // given
  const source = syncDriverSource(true)

  // when
  const result = await runIsolatedDriver(source)

  // then
  expect(result).toBe("resumed-without-prompt")
})

test("propagates a lifecycle persistence failure instead of converting it to a subagent result", async () => {
  // given
  const source = lifecycleFailureDriverSource()

  // when
  const result = await runIsolatedDriver(source)

  // then
  expect(result).toBe("persist-after-session-created")
})

test("forwards deny_all to the sync prompt dependency", async () => {
  // given
  const source = toolPolicyDriverSource("deny_all")

  // when
  const result = await runIsolatedDriver(source)

  // then
  expect(result).toBe("deny_all")
})

test("forwards a falsey malformed policy for fail-closed validation", async () => {
  // given
  const source = toolPolicyDriverSource("")

  // when
  const result = await runIsolatedDriver(source)

  // then
  expect(result).toBe("forwarded-empty")
})

async function runIsolatedDriver(source: string): Promise<string> {
  const child = Bun.spawn(["bun", "-e", source], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) throw new Error(stderr)
  return stdout.trim()
}

function syncDriverSource(resume: boolean): string {
  return `
    import { createOpencodeClient } from "@opencode-ai/sdk";
    import { runSyncSubagentText } from "./src/tools/openmath-solve-only/run-sync-subagent.ts";

    const key = "d".repeat(64);
    const created = [];
    const prompted = [];
    const callbacks = [];
    let createCalls = 0;
    let promptCalls = 0;
    const result = await runSyncSubagentText({
      client: createOpencodeClient(),
      directory: "/project",
      parentSessionID: "persisted-parent",
      ctx: { sessionID: "resuming-caller", messageID: "message", agent: "tester", abort: new AbortController().signal },
      agentToUse: "solver",
      description: "stage dispatch",
      prompt: "payload",
      childTitle: "[openmath:" + key + "] solver run-1 round 1",
      promptMarker: "OPENMATH_ATTEMPT_KEY: " + key + "\\n",
      categoryModel: { providerID: "openai", modelID: "gpt-5.2", variant: "high" },
      systemContent: "immutable system",
      persistedSessionID: ${resume ? '"child-1"' : "undefined"},
      skipPrompt: ${resume},
      awaitedCallbacks: {
        onSessionCreated: async (sessionID) => { callbacks.push("created:" + sessionID); },
        onPromptSent: async (sessionID) => { callbacks.push("prompted:" + sessionID); },
      },
    }, {
      createSyncSession: async (_client, input) => {
        createCalls += 1;
        created.push(input.title ?? "");
        return { ok: true, sessionID: "child-1", parentDirectory: "/project" };
      },
      sendSyncPrompt: async (_client, input) => {
        promptCalls += 1;
        if ("tool_policy" in input) throw new Error("default policy field was injected");
        prompted.push(input.systemContent + "|" + input.categoryModel?.providerID + "/" + input.categoryModel?.modelID + "/" + input.categoryModel?.variant + "|" + input.args.prompt);
        return null;
      },
      pollSyncSession: async () => null,
      fetchSyncResult: async () => ({ ok: true, textContent: "output" }),
    });

    if (!result.ok || result.sessionID !== "child-1" || result.text !== "output") throw new Error("unexpected result");
    if (${resume}) {
      if (createCalls !== 0 || promptCalls !== 0 || callbacks.length !== 0) throw new Error("resumed dispatch created or sent");
      console.log("resumed-without-prompt");
    } else {
      if (created[0] !== "[openmath:" + key + "] solver run-1 round 1") throw new Error("child title changed");
      if (prompted[0] !== "immutable system|openai/gpt-5.2/high|OPENMATH_ATTEMPT_KEY: " + key + "\\npayload") throw new Error("prompt snapshot changed");
      if (callbacks.join(",") !== "created:child-1,prompted:child-1") throw new Error("callback order changed");
      console.log("created-and-prompted");
    }
  `
}

function lifecycleFailureDriverSource(): string {
  return `
    import { createOpencodeClient } from "@opencode-ai/sdk";
    import { runSyncSubagentText } from "./src/tools/openmath-solve-only/run-sync-subagent.ts";

    try {
      await runSyncSubagentText({
        client: createOpencodeClient(),
        directory: "/project",
        parentSessionID: "persisted-parent",
        ctx: { sessionID: "resuming-caller", messageID: "message", agent: "tester", abort: new AbortController().signal },
        agentToUse: "solver",
        description: "stage dispatch",
        prompt: "payload",
        awaitedCallbacks: {
          onSessionCreated: async () => { throw new Error("persist-after-session-created"); },
        },
      }, {
        createSyncSession: async () => ({ ok: true, sessionID: "child-1", parentDirectory: "/project" }),
        sendSyncPrompt: async () => null,
        pollSyncSession: async () => null,
        fetchSyncResult: async () => ({ ok: true, textContent: "output" }),
      });
      console.log("callback failure was converted");
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      console.log(error.message);
    }
  `
}

function toolPolicyDriverSource(policy: string): string {
  return `
    import { createOpencodeClient } from "@opencode-ai/sdk";
    import { runSyncSubagentText } from "./src/tools/openmath-solve-only/run-sync-subagent.ts";

    let observedPolicy = "missing";
    const result = await runSyncSubagentText({
      client: createOpencodeClient(),
      directory: "/project",
      parentSessionID: "campaign-parent",
      ctx: { sessionID: "campaign-caller", messageID: "message", agent: "tester", abort: new AbortController().signal },
      agentToUse: "solver",
      description: "candidate",
      prompt: "payload",
      tool_policy: ${JSON.stringify(policy)},
    }, {
      createSyncSession: async () => ({ ok: true, sessionID: "candidate-1", parentDirectory: "/project" }),
      sendSyncPrompt: async (_client, input) => {
        observedPolicy = input.tool_policy === "" ? "forwarded-empty" : input.tool_policy ?? "missing";
        return null;
      },
      pollSyncSession: async () => null,
      fetchSyncResult: async () => ({ ok: true, textContent: "output" }),
    });

    if (!result.ok) throw new Error(result.error);
    console.log(observedPolicy);
  `
}
