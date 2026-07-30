import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { OpenMathConfigSchema } from "../config/schema"
import { resolveWorkflowProfilePromptSources } from "../openmath/workflow"
import { compareAndSwapWorkflowState, readWorkflowState } from "../openmath/workflow/storage"
import type { WorkflowStateV1 } from "../openmath/workflow/state"
import type { StageRunnerRuntime } from "../openmath/workflow/stage-runner"
import { createOpenMathWorkflowAbortTool } from "./openmath-workflow-abort"
import { createOpenMathWorkflowAmendTool } from "./openmath-workflow-amend"
import { createOpenMathWorkflowReloadTool } from "./openmath-workflow-reload"
import { createOpenMathWorkflowStartTool } from "./openmath-workflow-start"
import { createOpenMathWorkflowStatusTool } from "./openmath-workflow-status"
import { createOpenMathWorkflowStepTool } from "./openmath-workflow-step"
import { WorkflowSuccessEnvelopeSchema, type OpenMathWorkflowToolOptions } from "./openmath-workflow-shared"

const context = { sessionID: "parent", messageID: "message", agent: "test", abort: new AbortController().signal }

describe("Task 12 final R4 execution coverage", () => {
  let directory: string

  beforeEach(() => { directory = mkdtempSync(join(tmpdir(), "openmath-final-r4-")) })
  afterEach(() => { rmSync(directory, { recursive: true, force: true }) })

  test("snapshots actual envelopes from all six tool factories", async () => {
    const tools = toolSet(options(directory, () => {}))
    const start = parse(await tools.start.execute({ run_id: "six", request: { kind: "markdown", instruction: "Solve." } }, context))
    const step = parse(await tools.step.execute({ run_id: "six", expected_state_revision: 0 }, context))
    const status = parse(await tools.status.execute({ run_id: "six" }, context))
    const amend = parse(await tools.amend.execute({ run_id: "six", expected_state_revision: Number(step.state_revision), operation: "add", kind: "question", scope: "next_review", content: "Check." }, context))
    const reload = parse(await tools.reload.execute({ run_id: "six", expected_state_revision: Number(amend.state_revision), targets: ["prompts"] }, context))
    const abort = parse(await tools.abort.execute({ run_id: "six", expected_state_revision: Number(reload.state_revision) }, context))
    const envelopes = [start, step, status, amend, reload, abort]
    expect(envelopes.every((value) => WorkflowSuccessEnvelopeSchema.safeParse(value).success)).toBe(true)
    expect(envelopes.map(snapshotEnvelope)).toMatchSnapshot()
  })

  test("reloads only selected prompt and reference snapshots without runtime construction", async () => {
    const prompt = join(directory, "prompt.md")
    const reference = join(directory, "reference.md")
    const manifest = join(directory, "refs.json")
    writeFileSync(prompt, "PROMPT_V1", "utf8")
    writeFileSync(reference, "REFERENCE_V1", "utf8")
    writeFileSync(manifest, JSON.stringify({ version: 1, references: [{ id: "r", path: "reference.md", role: "background", stages: ["solve"] }] }), "utf8")
    let runtimes = 0
    const config = configuredFileProfile(directory, prompt)
    const tools = toolSet({ ...options(directory, () => { runtimes++ }), openmathConfig: config })
    await tools.start.execute({ run_id: "reload", request: { kind: "markdown", instruction: "Solve." }, reference_manifest_path: manifest }, context)
    const initial = await readState(directory, "reload")
    writeFileSync(prompt, "PROMPT_V2", "utf8")
    await tools.reload.execute({ run_id: "reload", expected_state_revision: 0, targets: ["prompts"] }, context)
    const promptReloaded = await readState(directory, "reload")
    const referencesBefore = JSON.stringify(initial.reference_snapshot)
    expect(JSON.stringify(promptReloaded.reference_snapshot)).toBe(referencesBefore)
    expect(promptReloaded.profile_snapshot.snapshot_version).toBe(initial.profile_snapshot.snapshot_version + 1)
    expect(promptReloaded.profile_snapshot.solve.prompt).not.toEqual(initial.profile_snapshot.solve.prompt)
    writeFileSync(reference, "REFERENCE_V2", "utf8")
    await tools.reload.execute({ run_id: "reload", expected_state_revision: 1, targets: ["references"] }, context)
    const referenceReloaded = await readState(directory, "reload")
    expect(JSON.stringify(referenceReloaded.profile_snapshot)).toBe(JSON.stringify(promptReloaded.profile_snapshot))
    expect(referenceReloaded.reference_snapshot.version).toBe(promptReloaded.reference_snapshot.version + 1)
    expect(referenceReloaded.reference_snapshot.sha256).not.toBe(promptReloaded.reference_snapshot.sha256)
    expect(runtimes).toBe(0)
  })
})

function options(directory: string, runtimeCreated: () => void): OpenMathWorkflowToolOptions {
  return { directory, openmathConfig: OpenMathConfigSchema.parse({ default_workflow_profile: "profile", workflow_profiles: { profile: profile({ kind: "inline", content: "solve" }) } }), createStageRuntime: ({ state }) => { runtimeCreated(); return runtime(directory, state) } }
}

function configuredFileProfile(directory: string, prompt: string) {
  const config = OpenMathConfigSchema.parse({ default_workflow_profile: "profile", workflow_profiles: { profile: profile({ kind: "file", uri: `file://${prompt}` }) } })
  return { ...config, workflow_profiles: resolveWorkflowProfilePromptSources(config.workflow_profiles, directory) }
}

function profile(prompt: { readonly kind: "inline"; readonly content: string } | { readonly kind: "file"; readonly uri: string }) {
  return { solve: { agent: "solver", model: "openai/solver", prompt, output_adapter: "opaque_markdown" }, review: { agent: "reviewer", model: "openai/reviewer", prompt: { kind: "inline" as const, content: "review" }, output_adapter: "review_verdict_markdown" }, revise: { agent: "reviser", model: "openai/reviser", prompt: { kind: "inline" as const, content: "revise" }, output_adapter: "full_replace_markdown" }, min_review_rounds: 1, max_review_rounds: 2, required_consecutive_passes: 1, checkpoint: "none" as const }
}

function toolSet(options: OpenMathWorkflowToolOptions) { return { start: createOpenMathWorkflowStartTool(options), step: createOpenMathWorkflowStepTool(options), status: createOpenMathWorkflowStatusTool(options), amend: createOpenMathWorkflowAmendTool(options), reload: createOpenMathWorkflowReloadTool(options), abort: createOpenMathWorkflowAbortTool(options) } }
function runtime(directory: string, initial: WorkflowStateV1): StageRunnerRuntime {
  let current = initial
  let marker = ""
  return { persist: async (next) => { const result = await compareAndSwapWorkflowState({ directory, run_id: current.run_id, expected_state_revision: current.state_revision, next_state: next }); if (result.kind === "error") throw new Error(result.message); current = result.state; return current }, list_children: async () => [], get_session: async () => ({ title: "" }), list_messages: async () => [{ role: "user", text: marker }], dispatch: async (input) => { await input.awaited_callbacks.on_session_created?.("child"); marker = input.prompt_marker; await input.awaited_callbacks.on_prompt_sent?.("child"); return { ok: true, session_id: "child", text: "# artifact" } } }
}
async function readState(directory: string, runId: string) { const result = await readWorkflowState(directory, runId); if (result.kind === "error") throw new Error(result.message); return result.state }
function parse(value: unknown): Record<string, unknown> { return JSON.parse(String(value)) }

function snapshotEnvelope(envelope: Record<string, unknown>): Record<string, unknown> {
  const artifact = envelope.artifact
  if (typeof artifact !== "object" || artifact === null || !("content" in artifact) || typeof artifact.content !== "string") return envelope
  return { ...envelope, artifact: { ...artifact, content: artifact.content.replace(/\n/g, "\\n") } }
}
