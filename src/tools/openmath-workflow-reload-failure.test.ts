import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { OpenMathConfigSchema } from "../config/schema"
import { resolveWorkflowProfilePromptSources } from "../openmath/workflow"
import { getWorkflowRunDirectory } from "../openmath/workflow/storage"
import { createOpenMathWorkflowAbortTool } from "./openmath-workflow-abort"
import { createOpenMathWorkflowReloadTool } from "./openmath-workflow-reload"
import { createOpenMathWorkflowStartTool } from "./openmath-workflow-start"
import { WorkflowErrorEnvelopeSchema, type OpenMathWorkflowToolOptions } from "./openmath-workflow-shared"

const context = { sessionID: "parent", messageID: "message", agent: "test", abort: new AbortController().signal }

describe("Task 12 reload failure regressions", () => {
  let directory: string

  beforeEach(() => { directory = mkdtempSync(join(tmpdir(), "openmath-reload-failure-")) })
  afterEach(() => { rmSync(directory, { recursive: true, force: true }) })

  test("returns PROMPT_SOURCE_ERROR without mutating a READY workflow when its selected prompt disappears", async () => {
    const fixture = startPromptWorkflow(directory, "prompt-source")
    const tools = fixture.tools
    await fixture.started
    rmSync(fixture.source)
    const before = revisionBytes(directory, "prompt-source")
    const result = parse(await tools.reload.execute({ run_id: "prompt-source", expected_state_revision: 0, targets: ["prompts"] }, context))
    expect(result).toMatchObject({ ok: false, error_code: "PROMPT_SOURCE_ERROR" })
    expect(WorkflowErrorEnvelopeSchema.safeParse(result).success).toBe(true)
    expect(revisionBytes(directory, "prompt-source")).toEqual(before)
    expect(fixture.runtimes()).toBe(0)
  })

  test("returns REFERENCE_SOURCE_ERROR without mutating a READY workflow when its manifest disappears", async () => {
    const fixture = startReferenceWorkflow(directory, "reference-source")
    const tools = fixture.tools
    await fixture.started
    rmSync(fixture.source)
    const before = revisionBytes(directory, "reference-source")
    const result = parse(await tools.reload.execute({ run_id: "reference-source", expected_state_revision: 0, targets: ["references"] }, context))
    expect(result).toMatchObject({ ok: false, error_code: "REFERENCE_SOURCE_ERROR" })
    expect(WorkflowErrorEnvelopeSchema.safeParse(result).success).toBe(true)
    expect(revisionBytes(directory, "reference-source")).toEqual(before)
    expect(fixture.runtimes()).toBe(0)
  })

  test("returns STALE_STATE_REVISION before reading a broken selected prompt", async () => {
    const fixture = startPromptWorkflow(directory, "stale-source")
    const tools = fixture.tools
    await fixture.started
    rmSync(fixture.source)
    const before = revisionBytes(directory, "stale-source")
    const result = parse(await tools.reload.execute({ run_id: "stale-source", expected_state_revision: 1, targets: ["prompts"] }, context))
    expect(result).toMatchObject({ ok: false, error_code: "STALE_STATE_REVISION", current_state_revision: 0 })
    expect(WorkflowErrorEnvelopeSchema.safeParse(result).success).toBe(true)
    expect(revisionBytes(directory, "stale-source")).toEqual(before)
    expect(fixture.runtimes()).toBe(0)
  })

  test("returns ILLEGAL_TRANSITION before reading a broken selected prompt", async () => {
    const fixture = startPromptWorkflow(directory, "terminal-source")
    const tools = fixture.tools
    await fixture.started
    await tools.abort.execute({ run_id: "terminal-source", expected_state_revision: 0 }, context)
    rmSync(fixture.source)
    const before = revisionBytes(directory, "terminal-source")
    const result = parse(await tools.reload.execute({ run_id: "terminal-source", expected_state_revision: 1, targets: ["prompts"] }, context))
    expect(result).toMatchObject({ ok: false, error_code: "ILLEGAL_TRANSITION" })
    expect(WorkflowErrorEnvelopeSchema.safeParse(result).success).toBe(true)
    expect(revisionBytes(directory, "terminal-source")).toEqual(before)
    expect(fixture.runtimes()).toBe(0)
  })
})

function startPromptWorkflow(directory: string, runId: string) {
  const source = join(directory, `${runId}.md`)
  writeFileSync(source, "prompt", "utf8")
  const tools = toolsFor(directory, source)
  return { source, tools, runtimes: tools.runtimes, started: tools.start.execute({ run_id: runId, request: { kind: "markdown", instruction: "Solve." } }, context) }
}

function startReferenceWorkflow(directory: string, runId: string) {
  const source = join(directory, `${runId}.json`)
  const prompt = join(directory, `${runId}.md`)
  writeFileSync(source, JSON.stringify({ version: 1, references: [] }), "utf8")
  writeFileSync(prompt, "prompt", "utf8")
  const tools = toolsFor(directory, prompt)
  return { source, tools, runtimes: tools.runtimes, started: tools.start.execute({ run_id: runId, request: { kind: "markdown", instruction: "Solve." }, reference_manifest_path: source }, context) }
}

function toolsFor(directory: string, prompt: string) {
  let count = 0
  const config = OpenMathConfigSchema.parse({ default_workflow_profile: "profile", workflow_profiles: { profile: profile(prompt) } })
  const options: OpenMathWorkflowToolOptions = {
    directory,
    openmathConfig: { ...config, workflow_profiles: resolveWorkflowProfilePromptSources(config.workflow_profiles, directory) },
    createStageRuntime: () => { count++; throw new Error("reload must not create a stage runtime") },
  }
  return { start: createOpenMathWorkflowStartTool(options), reload: createOpenMathWorkflowReloadTool(options), abort: createOpenMathWorkflowAbortTool(options), runtimes: () => count }
}

function profile(prompt: string) {
  return { solve: { agent: "solver", model: "openai/solver", prompt: { kind: "file" as const, uri: `file://${prompt}` }, output_adapter: "opaque_markdown" }, review: { agent: "reviewer", model: "openai/reviewer", prompt: { kind: "inline" as const, content: "review" }, output_adapter: "review_verdict_markdown" }, revise: { agent: "reviser", model: "openai/reviser", prompt: { kind: "inline" as const, content: "revise" }, output_adapter: "full_replace_markdown" }, min_review_rounds: 1, max_review_rounds: 2, required_consecutive_passes: 1, checkpoint: "none" as const }
}

function revisionBytes(directory: string, runId: string): readonly [string, string][] {
  const runDirectory = getWorkflowRunDirectory(directory, runId)
  return readdirSync(runDirectory).filter((name) => name.startsWith("state.rev-")).sort().map((name) => [name, readFileSync(join(runDirectory, name), "utf8")])
}

function parse(value: unknown): Record<string, unknown> { return JSON.parse(String(value)) }
