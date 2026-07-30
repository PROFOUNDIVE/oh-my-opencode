import { afterEach, beforeEach, expect, mock, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { readWorkflowState } from "../../openmath/workflow/storage"
import type { ToolContextWithMetadata } from "../delegate-task/types"
import {
  createCharacterizationArtifacts,
  createReviewResult,
  parseDispatchedPayload,
  type DispatchedSubagentCall,
  type SubagentResult,
} from "./workflow-characterization-fixtures"

let dispatchSubagent: (call: DispatchedSubagentCall) => Promise<SubagentResult>

mock.module("./run-sync-subagent", () => ({
  runSyncSubagentText: (call: DispatchedSubagentCall) => dispatchSubagent(call),
}))

import { createOpenMathSolveOnlyTool } from "./tools"

const context: ToolContextWithMetadata = {
  sessionID: "parent-session",
  messageID: "message",
  agent: "test-agent",
  abort: new AbortController().signal,
}

let directory: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "openmath-patch-identity-"))
})

afterEach(() => {
  mock.restore()
  rmSync(directory, { recursive: true, force: true })
})

test("keeps patch apply error identity distinct across legacy workflow recovery", async () => {
  // given
  const calls: string[] = []
  dispatchSubagent = async (call) => {
    const payload = parseDispatchedPayload(call.prompt)
    const reviewRound = Number(/round (\d+)/.exec(call.description)?.[1] ?? payload.review_round ?? 1)
    calls.push(`${call.agentToUse}:${reviewRound}`)
    if (call.agentToUse === "solver-markdown") {
      return { ok: true, sessionID: `solve-${reviewRound}`, text: createCharacterizationArtifacts() }
    }
    if (call.agentToUse === "reference-reviewer-markdown") {
      return { ok: true, sessionID: `review-${reviewRound}`, text: createReviewResult(payload, reviewRound === 4 ? "[CORRECT]" : "[ERROR]") }
    }
    if (call.agentToUse === "solver-markdown-patch") {
      const sectionId = reviewRound === 2 ? "reference_solution" : "variant_problem"
      return {
        ok: true,
        sessionID: `patch-${reviewRound}`,
        text: JSON.stringify({
          base_hash: payload.base_hash,
          ops: reviewRound === 4 ? [] : [{
            op: "replace_unique_substring",
            section_id: sectionId,
            old: "this substring is absent from the artifact",
            new: "replacement",
          }],
        }),
      }
    }
    return { ok: false, error: `Unexpected agent ${call.agentToUse}` }
  }
  const tool = createOpenMathSolveOnlyTool({
    directory,
    client: Object.create(null),
    openmathConfig: { artifacts: { format: "markdown" }, max_review_rounds: 4, max_consecutive_patch_failures: 2 },
  })

  // when
  const result = JSON.parse(String(await tool.execute({
    session_id: "root",
    problems: [{ id: "identity", problem: "Prove it." }],
  }, context)))
  const workflow = await readWorkflowState(directory, "root::identity")

  // then
  expect(result.results[0]).toMatchObject({ rounds_used: 4, verdict: "[CORRECT]" })
  expect(calls).toEqual([
    "solver-markdown:1",
    "reference-reviewer-markdown:1",
    "solver-markdown-patch:2",
    "solver-markdown-patch:3",
    "solver-markdown-patch:4",
    "reference-reviewer-markdown:4",
  ])
  if (workflow.kind !== "ok" || workflow.state.legacy_projection.kind !== "solve_only") {
    throw new TypeError("Expected persisted solve-only workflow")
  }
  expect(workflow.state.legacy_projection.markdown_fallback?.sub_attempt_history).toEqual([
    { kind: "patch", review_round: 2, outcome: "FAILED", error_code: "UNIQUE_SUBSTRING_NOT_FOUND", section_id: "reference_solution" },
    { kind: "patch", review_round: 3, outcome: "FAILED", error_code: "UNIQUE_SUBSTRING_NOT_FOUND", section_id: "variant_problem" },
    { kind: "patch", review_round: 4, outcome: "COMPLETED", error_code: null, section_id: null },
  ])
  const failedReceipts = workflow.state.dispatch_attempts.filter((attempt) => (
    attempt.phase === "COMMITTED" && attempt.receipt.kind === "ERROR"
  ))
  expect(failedReceipts.map((attempt) => attempt.phase === "COMMITTED"
    && attempt.receipt.kind === "ERROR"
    && "adapter_error" in attempt.receipt
    ? attempt.receipt.adapter_error
    : null)).toEqual([
    expect.objectContaining({ patch_failure: { error_code: "UNIQUE_SUBSTRING_NOT_FOUND", section_id: "reference_solution" } }),
    expect.objectContaining({ patch_failure: { error_code: "UNIQUE_SUBSTRING_NOT_FOUND", section_id: "variant_problem" } }),
  ])
})
