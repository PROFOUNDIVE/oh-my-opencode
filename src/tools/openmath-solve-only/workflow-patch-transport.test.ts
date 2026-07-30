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
  directory = mkdtempSync(join(tmpdir(), "openmath-patch-transport-"))
})

afterEach(() => {
  mock.restore()
  rmSync(directory, { recursive: true, force: true })
})

test("records and retries legacy patch transport failures before threshold regeneration", async () => {
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
      return { ok: false, error: "transport unavailable", error_code: "AGENT_NOT_FOUND" }
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
    problems: [{ id: "transport", problem: "Prove it." }],
  }, context)))
  const workflow = await readWorkflowState(directory, "root::transport")

  // then
  expect(result.results[0]).toMatchObject({ rounds_used: 4, verdict: "[CORRECT]" })
  expect(calls).toEqual([
    "solver-markdown:1",
    "reference-reviewer-markdown:1",
    "solver-markdown-patch:2",
    "solver-markdown-patch:3",
    "solver-markdown:4",
    "reference-reviewer-markdown:4",
  ])
  if (workflow.kind !== "ok" || workflow.state.legacy_projection.kind !== "solve_only") {
    throw new TypeError("Expected persisted solve-only workflow")
  }
  expect(workflow.state.status).toBe("PASSED")
  expect(workflow.state.legacy_projection.markdown_fallback?.sub_attempt_history).toEqual([
    { kind: "patch", review_round: 2, outcome: "FAILED", error_code: "SOLVER_PATCH_FAILED", section_id: null },
    { kind: "patch", review_round: 3, outcome: "FAILED", error_code: "SOLVER_PATCH_FAILED", section_id: null },
    { kind: "regeneration", review_round: 4, outcome: "COMPLETED", error_code: null, section_id: null },
  ])
  const transportReceipts = workflow.state.dispatch_attempts.filter((attempt) => (
    attempt.phase === "COMMITTED" && attempt.receipt.kind === "ERROR"
  ))
  expect(transportReceipts.map((attempt) => attempt.phase === "COMMITTED" && attempt.receipt.kind === "ERROR"
    ? attempt.receipt.error_code
    : null)).toEqual(["SUBAGENT_FAILED", "SUBAGENT_FAILED"])
})
