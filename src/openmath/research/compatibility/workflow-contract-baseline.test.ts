import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { OpenMathConfigSchema } from "../../../config/schema"
import { createE2ERuntime, type E2ERuntimeControl } from "../../workflow/e2e-runtime"
import { getWorkflowRunDirectory, readWorkflowState } from "../../workflow/storage"
import type { WorkflowStateV1 } from "../../workflow/state"
import { WorkflowCheckpointPolicySchema, WorkflowStopPolicySchema } from "../../workflow"
import { ReviewDtoSchema } from "../../workflow/state"
import { OpenMathWorkflowAbortInputSchema } from "../../../tools/openmath-workflow-abort"
import { OpenMathWorkflowAmendInputSchema } from "../../../tools/openmath-workflow-amend"
import { OpenMathWorkflowReloadInputSchema } from "../../../tools/openmath-workflow-reload"
import { OpenMathWorkflowStartInputSchema, OpenMathWorkflowStartToolKey } from "../../../tools/openmath-workflow-start"
import { OpenMathWorkflowStatusInputSchema } from "../../../tools/openmath-workflow-status"
import { OpenMathWorkflowStepInputSchema, OpenMathWorkflowStepToolKey } from "../../../tools/openmath-workflow-step"
import { WorkflowErrorEnvelopeSchema, WorkflowSuccessEnvelopeSchema, type OpenMathWorkflowToolOptions } from "../../../tools/openmath-workflow-shared"
import { createOpenMathWorkflowTools } from "../../../tools/openmath-workflow-tools"

const HASH = "a".repeat(64)
const PASS_REVIEW = { round: 1, verdict: "PASS", raw_report: "PASS", raw_report_sha256: HASH, findings: [], checks_performed: ["proof"], session_id: "review-1", prompt_hash: HASH, reference_hash: HASH, artifact_input_hash: HASH } as const
const READY_ENVELOPE = { ok: true, run_id: "baseline", state_revision: 0, status: "READY", stage: "SOLVE", artifact: null, latest_review: null, next_actions: [{ action: "step_one_stage", required_state_revision: 0, reason: "READY_TO_RUN" }] } as const
const context = { sessionID: "baseline-parent", messageID: "baseline-message", agent: "test", abort: new AbortController().signal }

describe("workflow public contract baseline", () => {
  let directory: string

  beforeEach(() => { directory = mkdtempSync(join(tmpdir(), "openmath-contract-baseline-")) })
  afterEach(() => { rmSync(directory, { recursive: true, force: true }) })

  test("publishes exactly six strict tool inputs from the aggregator", () => {
    const options: OpenMathWorkflowToolOptions = { directory, openmathConfig: OpenMathConfigSchema.parse({}) }
    const schemas = [
      [OpenMathWorkflowStartInputSchema, { run_id: "run", request: { kind: "markdown", instruction: "Prove it." } }],
      [OpenMathWorkflowStepInputSchema, { run_id: "run", expected_state_revision: 0, mode: "one_stage" }],
      [OpenMathWorkflowStatusInputSchema, { run_id: "run" }],
      [OpenMathWorkflowAmendInputSchema, { run_id: "run", expected_state_revision: 0, operation: "add", kind: "required_check", scope: "next_review", content: "Check." }],
      [OpenMathWorkflowReloadInputSchema, { run_id: "run", expected_state_revision: 0, targets: ["prompts"] }],
      [OpenMathWorkflowAbortInputSchema, { run_id: "run", expected_state_revision: 0 }],
    ] as const

    expect(Object.keys(createOpenMathWorkflowTools(options))).toEqual([
      "openmath_workflow_start", "openmath_workflow_step", "openmath_workflow_status",
      "openmath_workflow_amend", "openmath_workflow_reload", "openmath_workflow_abort",
    ])
    expect(schemas.map(([schema, input]) => schema.safeParse(input).success)).toEqual([true, true, true, true, true, true])
    expect(schemas.map(([schema, input]) => schema.safeParse({ ...input, unexpected: true }).success)).toEqual([false, false, false, false, false, false])
  })

  test("keeps envelopes and workflow literals closed", () => {
    const alteredStage = { ...READY_ENVELOPE, stage: "FORMALIZE" }
    const alteredEnvelope = { ...READY_ENVELOPE, additional_field: true }
    const staleError = { ok: false, error_code: "STALE_STATE_REVISION", message: "stale", current_state_revision: 2 }
    const stages = ["SOLVE", "REVIEW", "REVISE"] as const
    const statuses = ["READY", "RUNNING", "AWAITING_HUMAN", "PASSED", "EXHAUSTED", "ABORTED", "BLOCKED"] as const
    const verdicts = ["PASS", "REVISE", "INCONCLUSIVE"] as const

    expect(WorkflowSuccessEnvelopeSchema.safeParse(READY_ENVELOPE).success).toBe(true)
    expect(WorkflowErrorEnvelopeSchema.safeParse(staleError).success).toBe(true)
    expect(WorkflowSuccessEnvelopeSchema.safeParse(alteredStage).success).toBe(false)
    expect(WorkflowSuccessEnvelopeSchema.safeParse(alteredEnvelope).success).toBe(false)
    expect(WorkflowSuccessEnvelopeSchema.safeParse({ ...READY_ENVELOPE, status: "FORMALIZE" }).success).toBe(false)
    expect(stages.map((stage) => WorkflowSuccessEnvelopeSchema.safeParse({ ...READY_ENVELOPE, stage }).success)).toEqual([true, true, true])
    expect(statuses.map((status) => WorkflowSuccessEnvelopeSchema.safeParse({ ...READY_ENVELOPE, status }).success)).toEqual([true, true, true, true, true, true, true])
    expect(verdicts.map((verdict) => ReviewDtoSchema.safeParse({ ...PASS_REVIEW, verdict }).success)).toEqual([true, true, true])
    expect(ReviewDtoSchema.safeParse({ ...PASS_REVIEW, verdict: "FORMALIZE" }).success).toBe(false)
  })

  test("preserves checkpoint and stop-policy matrices", () => {
    expect(WorkflowCheckpointPolicySchema.options).toEqual(["none", "after_solve", "after_review", "every_stage"])
    expect(WorkflowStopPolicySchema.safeParse({ min_review_rounds: 1, max_review_rounds: 3, required_consecutive_passes: 2 }).success).toBe(true)
    expect(WorkflowStopPolicySchema.safeParse({ min_review_rounds: 3, max_review_rounds: 2, required_consecutive_passes: 1 }).success).toBe(false)
  })

  test("runs an aggregated solve-review-revise-pass transcript without rewriting prior revisions", async () => {
    const control: E2ERuntimeControl = { mode: "normal", crashed: false, verdicts: ["REVISE", "PASS"], childCount: 0, knownTitle: "", children: [], messages: [] }
    const tools = createOpenMathWorkflowTools(workflowOptions(directory, control))
    const start = success(await tools[OpenMathWorkflowStartToolKey]?.execute({ run_id: "baseline", request: { kind: "markdown", instruction: "Prove it." } }, context))
    const first = success(await tools[OpenMathWorkflowStepToolKey]?.execute({ run_id: "baseline", expected_state_revision: start.state_revision, mode: "to_checkpoint" }, context))
    const before = revisionBytes(directory, "baseline")
    const final = success(await tools[OpenMathWorkflowStepToolKey]?.execute({ run_id: "baseline", expected_state_revision: first.state_revision, mode: "to_checkpoint" }, context))
    const state = await workflowState(directory, "baseline")

    expect(final.status).toBe("PASSED")
    expect(state.stage_history.map((record) => record.stage)).toEqual(["SOLVE", "REVIEW", "REVISE", "REVIEW"])
    expect(revisionBytes(directory, "baseline").slice(0, before.length)).toEqual(before)
    expect(final.state_revision).toBeGreaterThan(first.state_revision)
  })

  test("failure probe fails only when the fourth stage becomes accepted", () => {
    const fourthStageAccepted = WorkflowSuccessEnvelopeSchema.safeParse({ ...READY_ENVELOPE, stage: "FORMALIZE" }).success
    if (process.env.WORKFLOW_CONTRACT_FAILURE_PROBE === "fourth-stage") {
      expect(fourthStageAccepted).toBe(true)
      return
    }
    expect(fourthStageAccepted).toBe(false)
  })
})

function workflowOptions(directory: string, control: E2ERuntimeControl): OpenMathWorkflowToolOptions {
  const openmathConfig = OpenMathConfigSchema.parse({
    default_workflow_profile: "baseline",
    workflow_allowed_roots: [directory],
    workflow_profiles: {
      baseline: {
        solve: role("solver", "opaque_markdown"),
        review: role("reviewer", "review_verdict_markdown"),
        revise: role("reviser", "full_replace_markdown"),
        min_review_rounds: 1,
        max_review_rounds: 2,
        required_consecutive_passes: 1,
        checkpoint: "after_review",
      },
    },
  })
  return { directory, openmathConfig, createStageRuntime: ({ state }) => createE2ERuntime(directory, state, control) }
}

function role(agent: string, outputAdapter: "opaque_markdown" | "review_verdict_markdown" | "full_replace_markdown") {
  return { agent, model: `openai/${agent}`, prompt: { kind: "inline" as const, content: agent }, output_adapter: outputAdapter }
}

function revisionBytes(directory: string, runID: string): readonly [string, string][] {
  const runDirectory = getWorkflowRunDirectory(directory, runID)
  return readdirSync(runDirectory).filter((name) => name.startsWith("state.rev-")).sort().map((name) => [name, readFileSync(join(runDirectory, name), "utf8")])
}

function success(value: unknown) {
  return WorkflowSuccessEnvelopeSchema.parse(JSON.parse(String(value)))
}

async function workflowState(directory: string, runID: string): Promise<WorkflowStateV1> {
  const result = await readWorkflowState(directory, runID)
  if (result.kind === "error") throw new Error(result.message)
  return result.state
}
