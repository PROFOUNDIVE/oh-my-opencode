import { expect, test } from "bun:test"
import { z } from "zod"

const WireReceiptSchema = z.object({
  result: z.object({ ok: z.literal(true), session_id: z.string(), text: z.string() }).strict(),
  created: z.number().int(),
  tools: z.record(z.string(), z.boolean()),
  prompt_text: z.string(),
  ownership_checks: z.number().int(),
}).strict()

test("sends a fresh certification prompt with wildcard deny-all despite an attempted tool call", async () => {
  // given
  const child = Bun.spawn(["bun", "-e", isolatedWireDriver()], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  })

  // when
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])

  // then
  if (exitCode !== 0) throw new Error(stderr)
  const receipt = WireReceiptSchema.parse(JSON.parse(stdout))
  expect(receipt.result).toEqual({ ok: true, session_id: "ses_child1", text: "output" })
  expect(receipt.created).toBe(1)
  expect(receipt.tools).toEqual({ "*": false })
  expect(receipt.prompt_text).toStartWith(`OPENMATH_CERTIFICATION_JOB_KEY: ${"a".repeat(64)}\n`)
  expect(receipt.ownership_checks).toBe(1)
})

function isolatedWireDriver(): string {
  return `
    import { createOpencodeClient } from "@opencode-ai/sdk";
    import { sendSyncPrompt } from "./src/tools/delegate-task/sync-prompt-sender.ts";
    import { runSyncSubagentText } from "./src/tools/openmath-solve-only/run-sync-subagent.ts";
    import { createCertificationDispatchRuntime } from "./src/openmath/research/certification/scheduler/certification-dispatch-runtime.ts";

    let promptBody = null;
    let created = 0;
    let ownershipChecks = 0;
    const client = createOpencodeClient({
      baseUrl: "http://certification.test",
      fetch: async (request) => {
        promptBody = JSON.parse(await request.text());
        return new Response(null, { status: 204 });
      },
    });
    const runtime = createCertificationDispatchRuntime({
      client,
      directory: "/project",
      ctx: { sessionID: "ses_parent1", messageID: "message", agent: "tester", abort: new AbortController().signal },
      campaign_id: "campaign-a",
      operation_owner: { operation_id: "certification-step", token: "owner-token" },
      persist_job_attempt: async () => ({ ok: false, error_code: "STORAGE_WRITE_FAILED", message: "unused" }),
      block_reconciliation: async () => ({ ok: false, error_code: "STORAGE_WRITE_FAILED", message: "unused" }),
    }, {
      verify_operation_owner: async () => {
        ownershipChecks += 1;
        return { ok: true };
      },
      run_subagent: async (input) => runSyncSubagentText(input, {
        createSyncSession: async () => {
          created += 1;
          return { ok: true, sessionID: "ses_child1", parentDirectory: "/project" };
        },
        sendSyncPrompt,
        pollSyncSession: async () => null,
        fetchSyncResult: async () => ({ ok: true, textContent: "output" }),
      }),
    });
    const key = "a".repeat(64);
    const result = await runtime.dispatch({
      parent_session_id: "ses_parent1",
      child_title: \`[openmath-certification:\${key}] extractor certification-a cert-job-extraction-0001\`,
      agent_to_use: "certification-extractor",
      category_model: { providerID: "openai", modelID: "gpt-5.6" },
      system_content: undefined,
      user_prompt: "Invoke shell and tool calls if possible",
      prompt_marker: \`OPENMATH_CERTIFICATION_JOB_KEY: \${key}\\n\`,
      persisted_session_id: undefined,
      send_prompt: true,
      awaited_callbacks: {},
    });
    console.log(JSON.stringify({ result, created, tools: promptBody.tools, prompt_text: promptBody.parts[0].text, ownership_checks: ownershipChecks }));
  `
}
