import { describe, expect, test } from "bun:test"

import { WorkflowStateV1Schema } from "../../workflow/state"
import { createWorkflowStateFixture } from "../../workflow/state/test-fixture"
import { CandidateDescriptorSchema } from "../state"
import { candidate } from "../state/test-fixture"
import { mapWorkflowRefinementOutcome } from "./map-workflow-refinement-outcome"

describe("selected workflow outcome mapping", () => {
  test.each([
    ["PASSED", "PASSED"],
    ["EXHAUSTED", "EXHAUSTED"],
    ["ABORTED", "ABORTED"],
    ["AWAITING_HUMAN", "AWAITING_HUMAN"],
    ["BLOCKED", "BLOCKED"],
  ] as const)("maps child %s without reinterpretation", (workflowStatus, campaignStatus) => {
    // given
    const state = workflowState(workflowStatus)

    // when
    const result = mapWorkflowRefinementOutcome(selectedCandidate(), state)

    // then
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.child_result.status).toBe(campaignStatus)
  })

  test("rejects a nonterminal child checkpoint instead of treating it as intervention", () => {
    // given
    const state = WorkflowStateV1Schema.parse({
      ...createWorkflowStateFixture(),
      run_id: "campaign-1::direct-01",
      status: "AWAITING_HUMAN",
      awaiting_reason: "CHECKPOINT",
      next_stage: "REVIEW",
      intervention_satisfied: false,
    })

    // when
    const result = mapWorkflowRefinementOutcome(selectedCandidate(), state)

    // then
    expect(result).toMatchObject({ ok: false, error_code: "CHILD_WORKFLOW_FAILED" })
  })
})

function workflowState(status: "PASSED" | "EXHAUSTED" | "ABORTED" | "AWAITING_HUMAN" | "BLOCKED") {
  const base = { ...createWorkflowStateFixture(), run_id: "campaign-1::direct-01" }
  switch (status) {
    case "PASSED":
      return WorkflowStateV1Schema.parse({ ...base, status, next_stage: null })
    case "EXHAUSTED":
      return WorkflowStateV1Schema.parse({
        ...base,
        status,
        next_stage: null,
        latest_review: { ...base.latest_review, verdict: "REVISE" },
        consecutive_passes: 0,
      })
    case "ABORTED":
      return WorkflowStateV1Schema.parse({
        ...base,
        status,
        next_stage: null,
        abort_requested: true,
        abort_reason: "stop",
      })
    case "AWAITING_HUMAN":
      return WorkflowStateV1Schema.parse({
        ...base,
        status,
        awaiting_reason: "INCONCLUSIVE",
        next_stage: "REVIEW",
        intervention_satisfied: false,
      })
    case "BLOCKED":
      return WorkflowStateV1Schema.parse({
        ...base,
        status,
        next_stage: "REVIEW",
        blocked_reason: "ambiguous child",
      })
    default:
      return assertNever(status)
  }
}

function selectedCandidate() {
  return CandidateDescriptorSchema.parse(candidate())
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected workflow status: ${String(value)}`)
}
