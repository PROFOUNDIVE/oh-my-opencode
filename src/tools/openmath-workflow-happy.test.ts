import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { OpenMathConfigSchema } from "../config/schema"
import { readWorkflowState } from "../openmath/workflow/storage"
import type { StageRunnerRuntime } from "../openmath/workflow/stage-runner"
import { createOpenMathWorkflowAbortTool } from "./openmath-workflow-abort"
import { createOpenMathWorkflowAmendTool } from "./openmath-workflow-amend"
import { createOpenMathWorkflowReloadTool } from "./openmath-workflow-reload"
import { createOpenMathWorkflowStartTool } from "./openmath-workflow-start"
import { createOpenMathWorkflowStatusTool } from "./openmath-workflow-status"
import { createOpenMathWorkflowStepTool } from "./openmath-workflow-step"
import type { OpenMathWorkflowToolOptions } from "./openmath-workflow-shared"
import { compareAndSwapWorkflowState } from "../openmath/workflow/storage"
import type { WorkflowStateV1 } from "../openmath/workflow/state"

const context = { sessionID: "parent-session", messageID: "message", agent: "test", abort: new AbortController().signal }

describe("OpenMath workflow happy contracts", () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "openmath-workflow-tool-"))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  test("starts, reports, amends, reloads, and aborts with revision-bound envelopes", async () => {
    // #given
    const options = workflowOptions(directory, "none")
    const start = createOpenMathWorkflowStartTool(options)
    const status = createOpenMathWorkflowStatusTool(options)
    const amend = createOpenMathWorkflowAmendTool(options)
    const reload = createOpenMathWorkflowReloadTool(options)
    const abort = createOpenMathWorkflowAbortTool(options)

    // #when
    const started = parse(await start.execute({ run_id: "run-lifecycle", request: { kind: "problem", source: { kind: "text", text: "Prove it." } } }, context))
    const reported = parse(await status.execute({ run_id: "run-lifecycle" }, context))
    const added = parse(await amend.execute({ run_id: "run-lifecycle", expected_state_revision: 0, operation: "add", kind: "required_check", scope: "next_review", content: "Check endpoints." }, context))
    const reloaded = parse(await reload.execute({ run_id: "run-lifecycle", expected_state_revision: 1, targets: ["prompts"] }, context))
    const aborted = parse(await abort.execute({ run_id: "run-lifecycle", expected_state_revision: 2, reason: "complete" }, context))

    // #then
    expect(started).toMatchObject({ ok: true, state_revision: 0, stage: "SOLVE" })
    expect(reported).toMatchObject({ ok: true, state_revision: 0 })
    expect(reported.next_actions).toEqual(expect.arrayContaining([{ action: "step_one_stage", required_state_revision: 0, reason: "READY_TO_RUN" }]))
    expect(added).toMatchObject({ ok: true, state_revision: 1 })
    expect(reloaded).toMatchObject({ ok: true, state_revision: 2 })
    expect(aborted).toMatchObject({ ok: true, state_revision: 3, status: "ABORTED", stage: null, next_actions: [] })
    const persisted = await readWorkflowState(directory, "run-lifecycle")
    expect(persisted).toMatchObject({ kind: "ok" })
    if (persisted.kind === "ok") {
      expect(persisted.state.parent_session_id).toBe("parent-session")
      expect(persisted.state.profile_snapshot.snapshot_version).toBe(2)
      expect(persisted.state.amendments).toHaveLength(1)
    }
  })

  test("runs one-stage and to-checkpoint modes through persisted stage execution", async () => {
    // #given
    const oneStageOptions = workflowOptions(directory, "none")
    const checkpointOptions = workflowOptions(directory, "after_solve")
    const oneStart = createOpenMathWorkflowStartTool(oneStageOptions)
    const oneStep = createOpenMathWorkflowStepTool(oneStageOptions)
    const checkpointStart = createOpenMathWorkflowStartTool(checkpointOptions)
    const checkpointStep = createOpenMathWorkflowStepTool(checkpointOptions)

    // #when
    await oneStart.execute({ run_id: "run-one", request: { kind: "markdown", instruction: "Solve the problem." } }, context)
    const oneStage = parse(await oneStep.execute({ run_id: "run-one", expected_state_revision: 0, mode: "one_stage" }, context))
    await checkpointStart.execute({ run_id: "run-checkpoint", request: { kind: "markdown", instruction: "Solve the problem." } }, context)
    const checkpoint = parse(await checkpointStep.execute({ run_id: "run-checkpoint", expected_state_revision: 0, mode: "to_checkpoint" }, context))

    // #then
    expect(oneStage).toMatchObject({ ok: true, status: "READY", stage: "REVIEW" })
    expect(checkpoint).toMatchObject({ ok: true, status: "AWAITING_HUMAN", stage: "REVIEW" })
  })
})

function workflowOptions(directory: string, checkpoint: "none" | "after_solve"): OpenMathWorkflowToolOptions {
  return {
    directory,
    openmathConfig: OpenMathConfigSchema.parse({
      default_workflow_profile: "tool-profile",
      workflow_profiles: {
        "tool-profile": {
          solve: { agent: "solver", model: "openai/solver", prompt: { kind: "inline", content: "solve" }, output_adapter: "opaque_markdown" },
          review: { agent: "reviewer", model: "openai/reviewer", prompt: { kind: "inline", content: "review" }, output_adapter: "review_verdict_markdown" },
          revise: { agent: "reviser", model: "openai/reviser", prompt: { kind: "inline", content: "revise" }, output_adapter: "full_replace_markdown" },
          min_review_rounds: 1,
          max_review_rounds: 2,
          required_consecutive_passes: 1,
          checkpoint,
        },
      },
    }),
    createStageRuntime: ({ state }) => stageRuntime(directory, state),
  }
}

function stageRuntime(directory: string, initial: WorkflowStateV1): StageRunnerRuntime {
  let current = initial
  let marker = ""
  return {
    persist: async (next) => {
      const result = await compareAndSwapWorkflowState({ directory, run_id: current.run_id, expected_state_revision: current.state_revision, next_state: next })
      if (result.kind === "error") throw new Error(result.message)
      current = result.state
      return current
    },
    list_children: async () => [],
    get_session: async () => ({ title: "" }),
    list_messages: async () => [{ role: "user", text: marker }],
    dispatch: async (input) => {
      await input.awaited_callbacks.on_session_created?.("child")
      marker = input.prompt_marker
      await input.awaited_callbacks.on_prompt_sent?.("child")
      return { ok: true, session_id: "child", text: "# Artifact\n" }
    },
  }
}

function parse(value: unknown): Record<string, unknown> {
  return JSON.parse(String(value))
}
