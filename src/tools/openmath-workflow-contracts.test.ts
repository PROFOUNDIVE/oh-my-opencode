import { describe, expect, test } from "bun:test"

import "./openmath-workflow-happy.test"
import "./openmath-workflow-r4.test"
import "./openmath-workflow-final-r4.test"

import {
  OpenMathWorkflowAbortInputSchema,
  OpenMathWorkflowAbortToolKey,
} from "./openmath-workflow-abort"
import {
  OpenMathWorkflowAmendInputSchema,
  OpenMathWorkflowAmendToolKey,
} from "./openmath-workflow-amend"
import {
  WorkflowErrorEnvelopeSchema,
  WorkflowSuccessEnvelopeSchema,
} from "./openmath-workflow-shared"
import {
  OpenMathWorkflowReloadInputSchema,
  OpenMathWorkflowReloadToolKey,
} from "./openmath-workflow-reload"
import {
  OpenMathWorkflowStartInputSchema,
  OpenMathWorkflowStartToolKey,
} from "./openmath-workflow-start"
import {
  OpenMathWorkflowStatusInputSchema,
  OpenMathWorkflowStatusToolKey,
} from "./openmath-workflow-status"
import {
  OpenMathWorkflowStepInputSchema,
  OpenMathWorkflowStepToolKey,
} from "./openmath-workflow-step"

const HASH = "a".repeat(64)

describe("OpenMath workflow tool contracts", () => {
  test("publishes the exact unregistered workflow tool keys", () => {
    expect([
      OpenMathWorkflowStartToolKey,
      OpenMathWorkflowStepToolKey,
      OpenMathWorkflowStatusToolKey,
      OpenMathWorkflowAmendToolKey,
      OpenMathWorkflowReloadToolKey,
      OpenMathWorkflowAbortToolKey,
    ]).toEqual([
      "openmath_workflow_start",
      "openmath_workflow_step",
      "openmath_workflow_status",
      "openmath_workflow_amend",
      "openmath_workflow_reload",
      "openmath_workflow_abort",
    ])
  })

  test("accepts every exact public input shape", () => {
    // #given
    const inputs = [
      OpenMathWorkflowStartInputSchema.safeParse({
        run_id: "run-1",
        request: { kind: "problem", source: { kind: "text", text: "Prove the claim." } },
      }),
      OpenMathWorkflowStepInputSchema.safeParse({ run_id: "run-1", expected_state_revision: 0, mode: "one_stage" }),
      OpenMathWorkflowStatusInputSchema.safeParse({ run_id: "run-1" }),
      OpenMathWorkflowAmendInputSchema.safeParse({
        run_id: "run-1",
        expected_state_revision: 0,
        operation: "add",
        kind: "required_check",
        scope: "round:2",
        content: "Check the endpoint.",
      }),
      OpenMathWorkflowAmendInputSchema.safeParse({
        run_id: "run-1",
        expected_state_revision: 1,
        operation: "retract",
        amendment_id: "amendment-1",
      }),
      OpenMathWorkflowReloadInputSchema.safeParse({ run_id: "run-1", expected_state_revision: 1, targets: ["prompts", "references"] }),
      OpenMathWorkflowAbortInputSchema.safeParse({ run_id: "run-1", expected_state_revision: 1, reason: "stop" }),
    ]

    // #when
    const accepted = inputs.every((result) => result.success)

    // #then
    expect(accepted).toBe(true)
  })

  test("projects the exact shared success and error envelopes", () => {
    // #given
    const success = {
      ok: true,
      run_id: "run-1",
      state_revision: 1,
      status: "READY",
      stage: "SOLVE",
      artifact: null,
      latest_review: null,
      next_actions: [{ action: "step_one_stage", required_state_revision: 1, reason: "READY_TO_RUN" }],
    }
    const error = { ok: false, error_code: "STALE_STATE_REVISION", message: "stale", current_state_revision: 1 }

    // #when
    const parsedSuccess = WorkflowSuccessEnvelopeSchema.safeParse(success)
    const parsedError = WorkflowErrorEnvelopeSchema.safeParse(error)

    // #then
    expect(parsedSuccess.success).toBe(true)
    expect(parsedError.success).toBe(true)
    expect(HASH).toHaveLength(64)
  })
})
