import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { OpenMathConfigSchema } from "../config/schema"
import { readWorkflowState } from "../openmath/workflow/storage"
import { createOpenMathWorkflowAbortTool } from "./openmath-workflow-abort"
import { OpenMathWorkflowAmendInputSchema } from "./openmath-workflow-amend"
import { createOpenMathWorkflowAmendTool } from "./openmath-workflow-amend"
import { OpenMathWorkflowReloadInputSchema } from "./openmath-workflow-reload"
import { createOpenMathWorkflowReloadTool } from "./openmath-workflow-reload"
import { OpenMathWorkflowStartInputSchema } from "./openmath-workflow-start"
import { createOpenMathWorkflowStartTool } from "./openmath-workflow-start"
import { OpenMathWorkflowStepInputSchema } from "./openmath-workflow-step"
import { createOpenMathWorkflowStepTool } from "./openmath-workflow-step"
import type { OpenMathWorkflowToolOptions } from "./openmath-workflow-shared"

import "./openmath-workflow-path-failure.test"
import "./openmath-workflow-mutation-failure.test"
import "./openmath-workflow-reload-failure.test"
import "./openmath-workflow-review-regressions.test"

const context = { sessionID: "parent", messageID: "message", agent: "test", abort: new AbortController().signal }

describe("OpenMath workflow tool contract failures", () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "openmath-workflow-failure-"))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  test("rejects blank and invalid public inputs", () => {
    // #given
    const invalidInputs = [
      OpenMathWorkflowStartInputSchema.safeParse({ run_id: " ", request: { kind: "markdown", instruction: " " } }),
      OpenMathWorkflowStepInputSchema.safeParse({ run_id: "run-1", expected_state_revision: -1 }),
      OpenMathWorkflowReloadInputSchema.safeParse({ run_id: "run-1", expected_state_revision: 0, targets: [] }),
      OpenMathWorkflowReloadInputSchema.safeParse({ run_id: "run-1", expected_state_revision: 0, targets: ["prompts", "prompts"] }),
      OpenMathWorkflowAmendInputSchema.safeParse({
        run_id: "run-1",
        expected_state_revision: 0,
        operation: "add",
        kind: "question",
        scope: "next_review",
        content: " ",
        amendment_id: "caller-supplied",
      }),
      OpenMathWorkflowAmendInputSchema.safeParse({
        run_id: "run-1",
        expected_state_revision: 0,
        operation: "retract",
        amendment_id: "amendment-1",
        content: "illegal",
      }),
    ]

    // #when
    const rejected = invalidInputs.every((result) => !result.success)

    // #then
    expect(rejected).toBe(true)
  })

  test("preserves persisted bytes across rejected mutator paths", async () => {
    // #given
    const options = workflowOptions(directory)
    const start = createOpenMathWorkflowStartTool(options)
    const amend = createOpenMathWorkflowAmendTool(options)
    const reload = createOpenMathWorkflowReloadTool(options)
    const step = createOpenMathWorkflowStepTool(options)
    const abort = createOpenMathWorkflowAbortTool(options)
    await start.execute({ run_id: "run-immutable", request: { kind: "markdown", instruction: "Solve." } }, context)
    const before = await readWorkflowState(directory, "run-immutable")

    // #when
    const stale = parse(await step.execute({ run_id: "run-immutable", expected_state_revision: 2 }, context))
    const illegal = parse(await amend.execute({ run_id: "run-immutable", expected_state_revision: 0, operation: "retract", amendment_id: "amendment-1" }, context))
    const empty = parse(await reload.execute({ run_id: "run-immutable", expected_state_revision: 0, targets: [] }, context))
    await abort.execute({ run_id: "run-immutable", expected_state_revision: 0 }, context)
    const terminal = parse(await abort.execute({ run_id: "run-immutable", expected_state_revision: 1 }, context))
    const after = await readWorkflowState(directory, "run-immutable")

    // #then
    expect(stale).toMatchObject({ ok: false, error_code: "STALE_STATE_REVISION", current_state_revision: 0 })
    expect(illegal).toMatchObject({ ok: false, error_code: "ILLEGAL_TRANSITION" })
    expect(empty).toMatchObject({ ok: false, error_code: "VALIDATION_ERROR" })
    expect(terminal).toMatchObject({ ok: false, error_code: "ILLEGAL_TRANSITION" })
    expect(before).toMatchObject({ kind: "ok", state: { state_revision: 0 } })
    expect(after).toMatchObject({ kind: "ok", state: { state_revision: 1, status: "ABORTED" } })
  })

  test("rejects incomplete and cross-variant amendments before mutation", async () => {
    const options = workflowOptions(directory)
    const start = createOpenMathWorkflowStartTool(options)
    const amend = createOpenMathWorkflowAmendTool(options)
    await start.execute({ run_id: "run-amend-shape", request: { kind: "markdown", instruction: "Solve." } }, context)
    const before = await readWorkflowState(directory, "run-amend-shape")
    const results = await Promise.all([
      amend.execute({ run_id: "run-amend-shape", expected_state_revision: 0, operation: "add" }, context),
      amend.execute({ run_id: "run-amend-shape", expected_state_revision: 0, operation: "retract", amendment_id: "amendment-1", content: "illegal" }, context),
      amend.execute({ run_id: "run-amend-shape", expected_state_revision: 0, operation: "add", kind: "question", scope: "next_review", content: "check", amendment_id: "illegal" }, context),
    ])
    const after = await readWorkflowState(directory, "run-amend-shape")
    expect(results.map(parse).every((result) => result.error_code === "VALIDATION_ERROR")).toBe(true)
    expect(after).toEqual(before)
  })

  test("persists blank optional problem metadata accepted by the public request contract", async () => {
    const start = createOpenMathWorkflowStartTool(workflowOptions(directory))
    const result = parse(await start.execute({
      run_id: "run-blank-metadata",
      request: {
        kind: "problem",
        source: { kind: "text", text: "Solve." },
        subject: "",
        chapter_context: "",
        textbook_markdown: "",
        supplementary_refs: [""],
      },
    }, context))
    const state = await readWorkflowState(directory, "run-blank-metadata")
    expect(result).toMatchObject({ ok: true })
    expect(state).toMatchObject({ kind: "ok", state: { request_snapshot: { subject: "", chapter_context: "", textbook_markdown: "", supplementary_refs: [""] } } })
  })

  test("preflights terminal steps before constructing a stage runtime", async () => {
    let runtimeConstructed = 0
    const options = {
      ...workflowOptions(directory),
      createStageRuntime: () => {
        runtimeConstructed++
        throw new Error("terminal step must not construct a runtime")
      },
    }
    const start = createOpenMathWorkflowStartTool(options)
    const abort = createOpenMathWorkflowAbortTool(options)
    const step = createOpenMathWorkflowStepTool(options)
    await start.execute({ run_id: "run-terminal-preflight", request: { kind: "markdown", instruction: "Solve." } }, context)
    await abort.execute({ run_id: "run-terminal-preflight", expected_state_revision: 0 }, context)
    const result = parse(await step.execute({ run_id: "run-terminal-preflight", expected_state_revision: 1 }, context))
    const state = await readWorkflowState(directory, "run-terminal-preflight")
    expect(result).toMatchObject({ ok: false, error_code: "ILLEGAL_TRANSITION" })
    expect(runtimeConstructed).toBe(0)
    expect(state).toMatchObject({ kind: "ok", state: { state_revision: 1, status: "ABORTED" } })
  })
})

function workflowOptions(directory: string): OpenMathWorkflowToolOptions {
  return {
    directory,
    openmathConfig: OpenMathConfigSchema.parse({
      default_workflow_profile: "failure-profile",
      workflow_profiles: {
        "failure-profile": {
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
}

function parse(value: unknown): Record<string, unknown> {
  return JSON.parse(String(value))
}
