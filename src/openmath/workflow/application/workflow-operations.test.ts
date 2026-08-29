import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { OpenMathConfigSchema } from "../../../config/schema"
import { createOpenMathWorkflowAbortTool } from "../../../tools/openmath-workflow-abort"
import { createOpenMathWorkflowAmendTool } from "../../../tools/openmath-workflow-amend"
import { createOpenMathWorkflowStartTool } from "../../../tools/openmath-workflow-start"
import { createOpenMathWorkflowStatusTool } from "../../../tools/openmath-workflow-status"
import { createOpenMathWorkflowStepTool } from "../../../tools/openmath-workflow-step"
import { workflowErrorEnvelope, workflowSuccessEnvelope } from "../../../tools/openmath-workflow-shared/envelope"
import type { OpenMathWorkflowToolOptions } from "../../../tools/openmath-workflow-shared"
import { readWorkflowState } from "../storage"
import { abortWorkflow } from "./abort-workflow"
import { amendWorkflow } from "./amend-workflow"
import { getWorkflowStatus } from "./get-workflow-status"
import { stepWorkflow } from "./step-workflow"
import type { WorkflowApplicationResult } from "./workflow-application-result"

const context = { sessionID: "parent-session", messageID: "message", agent: "test", abort: new AbortController().signal }

describe("workflow application operations", () => {
  let directDirectory: string
  let wrapperDirectory: string
  let directOptions: OpenMathWorkflowToolOptions
  let wrapperOptions: OpenMathWorkflowToolOptions

  beforeEach(async () => {
    directDirectory = mkdtempSync(join(tmpdir(), "openmath-workflow-operations-direct-"))
    wrapperDirectory = mkdtempSync(join(tmpdir(), "openmath-workflow-operations-wrapper-"))
    directOptions = workflowOptions(directDirectory)
    wrapperOptions = workflowOptions(wrapperDirectory)
    const input = { run_id: "equivalent-operations", request: { kind: "markdown", instruction: "Solve." } } as const
    await createOpenMathWorkflowStartTool(directOptions).execute(input, context)
    await createOpenMathWorkflowStartTool(wrapperOptions).execute(input, context)
  })

  afterEach(() => {
    rmSync(directDirectory, { recursive: true, force: true })
    rmSync(wrapperDirectory, { recursive: true, force: true })
  })

  test("returns the same status as the public wrapper", async () => {
    // #given
    const wrapper = createOpenMathWorkflowStatusTool(wrapperOptions)

    // #when
    const direct = await getWorkflowStatus({ directory: directDirectory, run_id: "equivalent-operations" })
    const wrapped = parse(await wrapper.execute({ run_id: "equivalent-operations" }, context))

    // #then
    expect(envelope(direct)).toEqual(wrapped)
  })

  test("returns the same stale step error as the public wrapper", async () => {
    // #given
    const wrapper = createOpenMathWorkflowStepTool(wrapperOptions)

    // #when
    const direct = await stepWorkflow({
      directory: directDirectory,
      run_id: "equivalent-operations",
      expected_state_revision: 3,
      mode: "one_stage",
    }, { create_runtime: () => undefined })
    const wrapped = parse(await wrapper.execute({ run_id: "equivalent-operations", expected_state_revision: 3 }, context))

    // #then
    expect(envelope(direct)).toEqual(wrapped)
    expect(direct).toMatchObject({ kind: "error", error_code: "STALE_STATE_REVISION", current_state_revision: 0 })
    const evidencePath = process.env.TASK_2_STALE_EVIDENCE
    if (evidencePath !== undefined) {
      writeFileSync(evidencePath, `${JSON.stringify({ scenario: "stale step direct versus wrapper", direct: envelope(direct), wrapper: wrapped }, null, 2)}\n`)
    }
  })

  test("returns the same amendment state as the public wrapper", async () => {
    // #given
    const input = { directory: directDirectory, run_id: "equivalent-operations", expected_state_revision: 0, operation: "add", kind: "required_check", scope: "next_review", content: "Check endpoints." } as const
    const wrapper = createOpenMathWorkflowAmendTool(wrapperOptions)

    // #when
    const direct = await amendWorkflow(input)
    await wrapper.execute({ run_id: input.run_id, expected_state_revision: input.expected_state_revision, operation: input.operation, kind: input.kind, scope: input.scope, content: input.content }, context)
    const directPersisted = await readWorkflowState(directDirectory, input.run_id)
    const wrapperPersisted = await readWorkflowState(wrapperDirectory, input.run_id)

    // #then
    expect(direct.kind).toBe("ok")
    expect(directPersisted.kind).toBe("ok")
    expect(wrapperPersisted.kind).toBe("ok")
    if (direct.kind === "ok" && directPersisted.kind === "ok" && wrapperPersisted.kind === "ok") {
      const comparedDirectState = process.env.TASK_2_FULL_STATE_FAILURE_PROBE === "amendment"
        ? { ...directPersisted.state, amendments: [] }
        : directPersisted.state
      expect(comparedDirectState).toEqual(wrapperPersisted.state)
      expect(direct.state).toEqual(wrapperPersisted.state)
      expect(wrapperPersisted.state.amendments).toEqual([
        expect.objectContaining({ kind: "required_check", scope: "next_review", content: "Check endpoints." }),
      ])
    }
  })

  test("returns the same aborted state as the public wrapper", async () => {
    // #given
    const wrapper = createOpenMathWorkflowAbortTool(wrapperOptions)

    // #when
    const direct = await abortWorkflow({ directory: directDirectory, run_id: "equivalent-operations", expected_state_revision: 0, reason: "stop" })
    await wrapper.execute({ run_id: "equivalent-operations", expected_state_revision: 0, reason: "stop" }, context)
    const directPersisted = await readWorkflowState(directDirectory, "equivalent-operations")
    const wrapperPersisted = await readWorkflowState(wrapperDirectory, "equivalent-operations")

    // #then
    expect(direct.kind).toBe("ok")
    expect(directPersisted.kind).toBe("ok")
    expect(wrapperPersisted.kind).toBe("ok")
    if (direct.kind === "ok" && directPersisted.kind === "ok" && wrapperPersisted.kind === "ok") {
      expect(directPersisted.state).toEqual(wrapperPersisted.state)
      expect(direct.state).toEqual(wrapperPersisted.state)
      expect(wrapperPersisted.state.abort_reason).toBe("stop")
    }
  })
})

function workflowOptions(directory: string): OpenMathWorkflowToolOptions {
  return {
    directory,
    openmathConfig: OpenMathConfigSchema.parse({
      default_workflow_profile: "application-profile",
      workflow_profiles: {
        "application-profile": {
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

function envelope(result: WorkflowApplicationResult): object {
  return result.kind === "ok" ? workflowSuccessEnvelope(result.state) : workflowErrorEnvelope(result)
}

function parse(value: unknown): object {
  return JSON.parse(String(value))
}
