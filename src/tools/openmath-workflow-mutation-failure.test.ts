import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { OpenMathConfigSchema } from "../config/schema"
import { getWorkflowRunDirectory } from "../openmath/workflow/storage"
import { nodeStorageRuntime } from "../openmath/workflow/storage/node-storage-runtime"
import type { StorageRuntime } from "../openmath/workflow/storage/storage-runtime-contract"
import { createOpenMathWorkflowAbortTool } from "./openmath-workflow-abort"
import { createOpenMathWorkflowAmendTool } from "./openmath-workflow-amend"
import { createOpenMathWorkflowStartTool } from "./openmath-workflow-start"
import { WorkflowErrorEnvelopeSchema, type OpenMathWorkflowToolOptions } from "./openmath-workflow-shared"

const context = { sessionID: "parent", messageID: "message", agent: "test", abort: new AbortController().signal }

describe("Task 12 mutation error boundaries", () => {
  let directory: string
  let restoreIdentityFault: (() => void) | undefined

  beforeEach(() => { directory = mkdtempSync(join(tmpdir(), "openmath-mutation-failure-")) })
  afterEach(() => {
    restoreIdentityFault?.()
    rmSync(directory, { recursive: true, force: true })
  })

  test("amend resolves a strict error envelope when storage identity fails asynchronously", async () => {
    const tools = toolsFor(directory)
    await tools.start.execute({ run_id: "amend-fault", request: { kind: "markdown", instruction: "Solve." } }, context)
    const before = revisionBytes(directory, "amend-fault")
    restoreIdentityFault = injectIdentityFault()
    const result = parse(await tools.amend.execute({ run_id: "amend-fault", expected_state_revision: 0, operation: "add", kind: "question", scope: "next_review", content: "Check." }, context))
    expect(WorkflowErrorEnvelopeSchema.safeParse(result).success).toBe(true)
    expect(result).toMatchObject({ ok: false })
    expect(revisionBytes(directory, "amend-fault")).toEqual(before)
  })

  test("abort resolves a strict error envelope when storage identity fails asynchronously", async () => {
    const tools = toolsFor(directory)
    await tools.start.execute({ run_id: "abort-fault", request: { kind: "markdown", instruction: "Solve." } }, context)
    const before = revisionBytes(directory, "abort-fault")
    restoreIdentityFault = injectIdentityFault()
    const result = parse(await tools.abort.execute({ run_id: "abort-fault", expected_state_revision: 0 }, context))
    expect(WorkflowErrorEnvelopeSchema.safeParse(result).success).toBe(true)
    expect(result).toMatchObject({ ok: false })
    expect(revisionBytes(directory, "abort-fault")).toEqual(before)
  })
})

function toolsFor(directory: string) {
  const options: OpenMathWorkflowToolOptions = {
    directory,
    openmathConfig: OpenMathConfigSchema.parse({
      default_workflow_profile: "fault",
      workflow_profiles: {
        fault: {
          solve: { agent: "solver", model: "openai/solver", prompt: { kind: "inline", content: "solve" }, output_adapter: "opaque_markdown" },
          review: { agent: "reviewer", model: "openai/reviewer", prompt: { kind: "inline", content: "review" }, output_adapter: "review_verdict_markdown" },
          revise: { agent: "reviser", model: "openai/reviser", prompt: { kind: "inline", content: "revise" }, output_adapter: "full_replace_markdown" },
          min_review_rounds: 1,
          max_review_rounds: 2,
          required_consecutive_passes: 1,
          checkpoint: "none",
        },
      },
    }),
  }
  return { start: createOpenMathWorkflowStartTool(options), amend: createOpenMathWorkflowAmendTool(options), abort: createOpenMathWorkflowAbortTool(options) }
}

function injectIdentityFault(): () => void {
  const original: StorageRuntime["open"] = nodeStorageRuntime.open
  const spy = spyOn(nodeStorageRuntime, "open").mockImplementation(async (path: string, flags: "r" | "wx") => {
    const handle = await original(path, flags)
    return flags === "wx" ? { ...handle, identity: async () => { throw new Error("injected identity fault") } } : handle
  })
  return () => spy.mockRestore()
}

function revisionBytes(directory: string, runId: string): readonly [string, string][] {
  const runDirectory = getWorkflowRunDirectory(directory, runId)
  return readdirSync(runDirectory).filter((name) => name.startsWith("state.rev-")).sort().map((name) => [name, readFileSync(join(runDirectory, name), "utf8")])
}

function parse(value: unknown): Record<string, unknown> { return JSON.parse(String(value)) }
