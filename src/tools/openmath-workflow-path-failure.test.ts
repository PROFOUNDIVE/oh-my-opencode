import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { OpenMathConfigSchema } from "../config/schema"
import { resolveWorkflowProfilePromptSources } from "../openmath/workflow"
import { getWorkflowRunDirectory } from "../openmath/workflow/storage"
import { createOpenMathWorkflowAbortTool } from "./openmath-workflow-abort"
import { createOpenMathWorkflowAmendTool } from "./openmath-workflow-amend"
import { createOpenMathWorkflowReloadTool } from "./openmath-workflow-reload"
import { createOpenMathWorkflowStartTool } from "./openmath-workflow-start"
import { createOpenMathWorkflowStatusTool } from "./openmath-workflow-status"
import { createOpenMathWorkflowStepTool } from "./openmath-workflow-step"
import { WorkflowErrorEnvelopeSchema, type OpenMathWorkflowToolOptions } from "./openmath-workflow-shared"

const context = { sessionID: "parent", messageID: "message", agent: "test", abort: new AbortController().signal }

describe("OpenMath workflow path failures", () => {
  let directory: string
  let outside: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "openmath-workflow-path-"))
    outside = mkdtempSync(join(tmpdir(), "openmath-workflow-outside-"))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  })

  test("returns RUN_NOT_FOUND for every non-start tool without dispatch", async () => {
    let dispatches = 0
    const options = toolOptions(directory, () => { dispatches++ })
    const results = await Promise.all([
      createOpenMathWorkflowStatusTool(options).execute({ run_id: "missing" }, context),
      createOpenMathWorkflowStepTool(options).execute({ run_id: "missing", expected_state_revision: 0 }, context),
      createOpenMathWorkflowAmendTool(options).execute({ run_id: "missing", expected_state_revision: 0, operation: "add", kind: "question", scope: "next_review", content: "x" }, context),
      createOpenMathWorkflowReloadTool(options).execute({ run_id: "missing", expected_state_revision: 0, targets: ["prompts"] }, context),
      createOpenMathWorkflowAbortTool(options).execute({ run_id: "missing", expected_state_revision: 0 }, context),
    ])
    const parsed = results.map(parse)
    expect(parsed.every((result) => result.error_code === "RUN_NOT_FOUND" && WorkflowErrorEnvelopeSchema.safeParse(result).success)).toBe(true)
    expect(existsSync(getWorkflowRunDirectory(directory, "missing"))).toBe(false)
    expect(dispatches).toBe(0)
  })

  test("rejects profile, manifest, prompt, and problem sources before allocation", async () => {
    let dispatches = 0
    const outsideFile = join(outside, "outside.md")
    writeFileSync(outsideFile, "Problem 1\nOutside", "utf8")
    symlinkSync(outsideFile, join(directory, "escape.md"))
    writeFileSync(join(directory, "unsupported.txt"), "{}", "utf8")
    writeFileSync(join(directory, "oversize.md"), `Problem 1\n${"x".repeat(2_000_000)}`, "utf8")
    const options = toolOptions(directory, () => { dispatches++ })
    const start = createOpenMathWorkflowStartTool(options)
    const profile = parse(await start.execute({ run_id: "profile", workflow_profile: "missing-profile", request: markdownRequest() }, context))
    const manifests = await Promise.all([
      start.execute({ run_id: "manifest-missing", request: markdownRequest(), reference_manifest_path: "missing.json" }, context),
      start.execute({ run_id: "manifest-extension", request: markdownRequest(), reference_manifest_path: "unsupported.txt" }, context),
      start.execute({ run_id: "manifest-outside", request: markdownRequest(), reference_manifest_path: outsideFile }, context),
      start.execute({ run_id: "manifest-symlink", request: markdownRequest(), reference_manifest_path: "escape.md" }, context),
    ])
    const problems = await Promise.all([
      start.execute({ run_id: "problem-missing", request: fileRequest("missing.md") }, context),
      start.execute({ run_id: "problem-extension", request: fileRequest("unsupported.txt") }, context),
      start.execute({ run_id: "problem-oversize", request: fileRequest("oversize.md") }, context),
      start.execute({ run_id: "problem-outside", request: fileRequest(outsideFile) }, context),
      start.execute({ run_id: "problem-symlink", request: fileRequest("escape.md") }, context),
    ])
    expect(profile).toMatchObject({ error_code: "PROFILE_NOT_FOUND" })
    expect(manifests.map(parse).every((result) => result.error_code === "REFERENCE_SOURCE_ERROR")).toBe(true)
    expect(problems.map(parse).every((result) => result.error_code === "VALIDATION_ERROR")).toBe(true)
    expect([profile, ...manifests.map(parse), ...problems.map(parse)].every((result) => WorkflowErrorEnvelopeSchema.safeParse(result).success)).toBe(true)
    for (const runId of ["profile", "manifest-missing", "manifest-extension", "manifest-outside", "manifest-symlink", "problem-missing", "problem-extension", "problem-oversize", "problem-outside", "problem-symlink"]) {
      expect(existsSync(getWorkflowRunDirectory(directory, runId))).toBe(false)
    }
    expect(dispatches).toBe(0)
  })

  test("maps an outside file-backed prompt to PROMPT_SOURCE_ERROR before allocation", async () => {
    let dispatches = 0
    const promptPath = join(outside, "prompt.md")
    writeFileSync(promptPath, "outside prompt", "utf8")
    const config = OpenMathConfigSchema.parse({
      default_workflow_profile: "file-prompt",
      workflow_allowed_roots: [directory],
      workflow_profiles: { "file-prompt": profile({ kind: "file", uri: `file://${promptPath}` }) },
    })
    const resolved = { ...config, workflow_profiles: resolveWorkflowProfilePromptSources(config.workflow_profiles, directory) }
    const result = parse(await createOpenMathWorkflowStartTool({ ...toolOptions(directory, () => { dispatches++ }), openmathConfig: resolved }).execute({ run_id: "prompt-outside", request: markdownRequest() }, context))
    expect(result).toMatchObject({ error_code: "PROMPT_SOURCE_ERROR" })
    expect(WorkflowErrorEnvelopeSchema.safeParse(result).success).toBe(true)
    expect(existsSync(getWorkflowRunDirectory(directory, "prompt-outside"))).toBe(false)
    expect(dispatches).toBe(0)
  })
})

function toolOptions(directory: string, dispatched: () => void): OpenMathWorkflowToolOptions {
  return { directory, openmathConfig: OpenMathConfigSchema.parse({ default_workflow_profile: "failure", workflow_profiles: { failure: profile({ kind: "inline", content: "prompt" }) } }), createStageRuntime: () => { dispatched(); throw new Error("dispatch must not run") } }
}

function profile(prompt: { readonly kind: "inline"; readonly content: string } | { readonly kind: "file"; readonly uri: string }) {
  return { solve: { agent: "solver", model: "openai/solver", prompt, output_adapter: "opaque_markdown" }, review: { agent: "reviewer", model: "openai/reviewer", prompt: { kind: "inline" as const, content: "review" }, output_adapter: "review_verdict_markdown" }, revise: { agent: "reviser", model: "openai/reviser", prompt: { kind: "inline" as const, content: "revise" }, output_adapter: "full_replace_markdown" }, min_review_rounds: 1, max_review_rounds: 2, required_consecutive_passes: 1, checkpoint: "none" as const }
}

function markdownRequest() { return { kind: "markdown" as const, instruction: "Solve." } }
function fileRequest(file_path: string) { return { kind: "problem" as const, source: { kind: "file" as const, file_path, problem_number: 1 } } }
function parse(value: unknown): Record<string, unknown> { return JSON.parse(String(value)) }
