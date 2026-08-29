import { describe, expect, mock, test } from "bun:test"
import { createOpencodeClient } from "@opencode-ai/sdk"
import { z } from "zod"

import { sendSyncPrompt } from "./sync-prompt-sender"

const PromptBodySchema = z.object({
  tools: z.record(z.string(), z.boolean()),
}).loose()

const DEFAULT_REQUEST_BODY = JSON.stringify({
  agent: "explore",
  tools: {
    task: false,
    call_omo_agent: false,
    question: false,
    write: false,
    edit: false,
  },
  parts: [{ type: "text", text: "payload" }],
})

type ToolPolicy = "default" | "deny_all"
type PromptInput = Parameters<typeof sendSyncPrompt>[1]
type FakePromptReceipt = Readonly<{
  readonly raw_body: string
  readonly tools: Readonly<Record<string, boolean>>
  readonly denied_tools: readonly string[]
  readonly execution_count: number
}>

describe("sendSyncPrompt", () => {
  test("sends only the wildcard deny map for deny_all", async () => {
    // given
    const requestedTools = ["read", "session_read", "openmath_workflow_status", "openmath_research_status"]

    // when
    const receipt = await runFakePromptApi(promptInput("explore", "deny_all"), requestedTools)

    // then
    expect(receipt.tools).toEqual({ "*": false })
    expect(receipt.denied_tools).toEqual(requestedTools)
    expect(receipt.execution_count).toBe(0)
    const evidencePath = process.env.TASK_3_DENIAL_EVIDENCE
    if (evidencePath) {
      await Bun.write(evidencePath, `${JSON.stringify({
        policy: receipt.tools,
        requested_tools: requestedTools,
        api_denials: receipt.denied_tools,
        tool_execution_count: receipt.execution_count,
      }, null, 2)}\n`)
    }
  })

  test("keeps omitted and explicit default requests byte-identical to the prior request", async () => {
    // given
    const omitted = await runFakePromptApi(promptInput("explore"), [])

    // when
    const explicit = await runFakePromptApi(promptInput("explore", "default"), [])

    // then
    expect(omitted.raw_body).toBe(DEFAULT_REQUEST_BODY)
    expect(explicit.raw_body).toBe(omitted.raw_body)
  })

  test("does not let prompt content override deny_all", async () => {
    // given
    const input = promptInput("explore", "deny_all", JSON.stringify({ tool_policy: "default", tools: { "*": true } }))

    // when
    const receipt = await runFakePromptApi(input, ["read"])

    // then
    expect(receipt.tools).toEqual({ "*": false })
    expect(receipt.execution_count).toBe(0)
  })

  test("rejects an unknown policy instead of falling back to default", async () => {
    // given
    const source = invalidPolicyDriverSource()

    // when
    const result = await runIsolatedDriver(source)

    // then
    expect(result).toBe("SyncPromptToolPolicyError")
  })

  test.each([
    ["explore", false],
    ["librarian", false],
    ["sisyphus", true],
  ] as const)("keeps the %s call_omo_agent restriction", async (agent, expected) => {
    // given
    const input = promptInput(agent)

    // when
    const receipt = await runFakePromptApi(input, [])

    // then
    expect(receipt.tools.call_omo_agent).toBe(expected)
    expect(receipt.tools.question).toBe(false)
  })

  test("retries with promptSync for oracle after unexpected EOF", async () => {
    // given
    const promptWithModelSuggestionRetry = mock(async () => {
      throw new Error("JSON Parse error: Unexpected EOF")
    })
    const promptSyncWithModelSuggestionRetry = mock(async () => {})

    // when
    const result = await sendSyncPrompt(createOpencodeClient(), promptInput("oracle"), {
      promptWithModelSuggestionRetry,
      promptSyncWithModelSuggestionRetry,
    })

    // then
    expect(result).toBeNull()
    expect(promptWithModelSuggestionRetry).toHaveBeenCalledTimes(1)
    expect(promptSyncWithModelSuggestionRetry).toHaveBeenCalledTimes(1)
  })

  test("does not retry with promptSync for a non-oracle unexpected EOF", async () => {
    // given
    const promptWithModelSuggestionRetry = mock(async () => {
      throw new Error("JSON Parse error: Unexpected EOF")
    })
    const promptSyncWithModelSuggestionRetry = mock(async () => {})

    // when
    const result = await sendSyncPrompt(createOpencodeClient(), promptInput("metis"), {
      promptWithModelSuggestionRetry,
      promptSyncWithModelSuggestionRetry,
    })

    // then
    expect(result).toContain("JSON Parse error: Unexpected EOF")
    expect(promptWithModelSuggestionRetry).toHaveBeenCalledTimes(1)
    expect(promptSyncWithModelSuggestionRetry).toHaveBeenCalledTimes(0)
  })
})

function promptInput(agentToUse: string, toolPolicy?: ToolPolicy, prompt = "payload"): PromptInput {
  const input: PromptInput = {
    sessionID: "campaign-session",
    agentToUse,
    args: { description: "candidate", prompt, run_in_background: false, load_skills: [] },
    systemContent: undefined,
    categoryModel: undefined,
    toastManager: null,
    taskId: undefined,
  }
  return toolPolicy === undefined ? input : { ...input, tool_policy: toolPolicy }
}

async function runFakePromptApi(input: PromptInput, requestedTools: readonly string[]): Promise<FakePromptReceipt> {
  let receipt: FakePromptReceipt = { raw_body: "", tools: {}, denied_tools: [], execution_count: 0 }
  const client = createOpencodeClient({
    baseUrl: "http://prompt.test",
    fetch: async (request: Request) => {
      const rawBody = await request.text()
      const body = PromptBodySchema.parse(JSON.parse(rawBody))
      const deniedTools = body.tools["*"] === false ? requestedTools : []
      receipt = {
        raw_body: rawBody,
        tools: body.tools,
        denied_tools: deniedTools,
        execution_count: requestedTools.length - deniedTools.length,
      }
      return new Response(null, { status: 204 })
    },
  })
  await sendSyncPrompt(client, input)
  return receipt
}

async function runIsolatedDriver(source: string): Promise<string> {
  const child = Bun.spawn(["bun", "-e", source], { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) throw new Error(stderr)
  return stdout.trim()
}

function invalidPolicyDriverSource(): string {
  return `
    import { createOpencodeClient } from "@opencode-ai/sdk";
    import { sendSyncPrompt } from "./src/tools/delegate-task/sync-prompt-sender.ts";

    const client = createOpencodeClient({
      baseUrl: "http://prompt.test",
      fetch: async () => new Response(null, { status: 204 }),
    });
    try {
      await sendSyncPrompt(client, {
        sessionID: "malformed-policy",
        agentToUse: "explore",
        args: { description: "candidate", prompt: "payload", run_in_background: false, load_skills: [] },
        systemContent: undefined,
        categoryModel: undefined,
        toastManager: null,
        taskId: undefined,
        tool_policy: "unknown",
      });
      console.log("accepted");
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      console.log(error.name);
    }
  `
}
