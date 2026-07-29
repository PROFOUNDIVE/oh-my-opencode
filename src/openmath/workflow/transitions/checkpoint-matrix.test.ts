import { describe, expect, test } from "bun:test"

import { WorkflowStateV1Schema, type WorkflowStateV1 } from "../state"
import { reduceTransition } from "./index"
import { artifact, review, runningWithReceipt, withPolicy, workflowState } from "./test-fixture"

type Policy = "none" | "after_solve" | "after_review" | "every_stage"
type Stage = "SOLVE" | "REVIEW" | "REVISE"

const CHECKPOINT_MATRIX = [
  ["none", "SOLVE", "READY", null],
  ["none", "REVIEW", "READY", null],
  ["none", "REVISE", "READY", null],
  ["after_solve", "SOLVE", "AWAITING_HUMAN", "CHECKPOINT"],
  ["after_solve", "REVIEW", "READY", null],
  ["after_solve", "REVISE", "READY", null],
  ["after_review", "SOLVE", "READY", null],
  ["after_review", "REVIEW", "AWAITING_HUMAN", "CHECKPOINT"],
  ["after_review", "REVISE", "READY", null],
  ["every_stage", "SOLVE", "AWAITING_HUMAN", "CHECKPOINT"],
  ["every_stage", "REVIEW", "AWAITING_HUMAN", "CHECKPOINT"],
  ["every_stage", "REVISE", "AWAITING_HUMAN", "CHECKPOINT"],
] satisfies readonly (readonly [Policy, Stage, WorkflowStateV1["status"], "CHECKPOINT" | null])[]

describe("workflow checkpoint matrix", () => {
  test.each(CHECKPOINT_MATRIX)("applies %s to committed %s", (policy, stage, status, reason) => {
    // given
    const state = stageState(policy, stage)

    // when
    const result = reduceTransition(state, { type: "COMMIT_STAGE_RECEIPT" })

    // then
    expect(result).toMatchObject({ ok: true, state: { status, awaiting_reason: reason } })
    if (result.ok) expect(WorkflowStateV1Schema.safeParse(result.state).success).toBe(true)
  })

  test("terminal PASS overrides every-stage checkpoint", () => {
    // given
    const state = reviewState("PASS", 1, { min_review_rounds: 1, max_review_rounds: 3 })

    // when
    const result = reduceTransition(state, { type: "COMMIT_STAGE_RECEIPT" })

    // then
    expect(result).toMatchObject({ ok: true, state: { status: "PASSED", awaiting_reason: null } })
    if (result.ok) expect(WorkflowStateV1Schema.safeParse(result.state).success).toBe(true)
  })

  test.each(["REVISE", "INCONCLUSIVE"] as const)("terminal %s exhaustion overrides checkpoint", (verdict) => {
    // given
    const state = reviewState(verdict, 3, {
      min_review_rounds: 3,
      max_review_rounds: 3,
      completed_review_rounds: 2,
    })

    // when
    const result = reduceTransition(state, { type: "COMMIT_STAGE_RECEIPT" })

    // then
    expect(result).toMatchObject({ ok: true, state: { status: "EXHAUSTED", awaiting_reason: null } })
    if (result.ok) expect(WorkflowStateV1Schema.safeParse(result.state).success).toBe(true)
  })

  test("nonterminal INCONCLUSIVE overrides every-stage checkpoint with intervention pause", () => {
    // given
    const state = reviewState("INCONCLUSIVE", 1, { min_review_rounds: 2, max_review_rounds: 3 })

    // when
    const result = reduceTransition(state, { type: "COMMIT_STAGE_RECEIPT" })

    // then
    expect(result).toMatchObject({
      ok: true,
      state: { status: "AWAITING_HUMAN", awaiting_reason: "INCONCLUSIVE", intervention_satisfied: false },
    })
    if (result.ok) expect(WorkflowStateV1Schema.safeParse(result.state).success).toBe(true)
  })
})

function stageState(policy: Policy, stage: Stage): WorkflowStateV1 {
  const base = withPolicy(workflowState({
    next_stage: stage,
    artifact: stage === "SOLVE" ? null : artifact(),
  }), { checkpoint: policy, min_review_rounds: 2 })
  const receipt = stage === "REVIEW"
    ? { kind: "REVIEW" as const, review: review(1, "PASS") }
    : { kind: "ARTIFACT" as const, artifact: artifact(stage === "REVISE" ? 2 : 1) }
  return runningWithReceipt(base, stage, receipt)
}

function reviewState(
  verdict: "PASS" | "REVISE" | "INCONCLUSIVE",
  round: number,
  policy: {
    readonly min_review_rounds: number
    readonly max_review_rounds: number
    readonly completed_review_rounds?: number
  },
): WorkflowStateV1 {
  const base = withPolicy(workflowState({
    next_stage: "REVIEW",
    artifact: artifact(),
    review_round: round,
    completed_review_rounds: policy.completed_review_rounds ?? 0,
  }), {
    checkpoint: "every_stage",
    min_review_rounds: policy.min_review_rounds,
    max_review_rounds: policy.max_review_rounds,
  })
  return runningWithReceipt(base, "REVIEW", { kind: "REVIEW", review: review(round, verdict) })
}
