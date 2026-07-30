import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
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

describe("solve-only workflow markdown fallback history", () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "openmath-workflow-fallback-"))
  })

  afterEach(() => {
    mock.restore()
    rmSync(directory, { recursive: true, force: true })
  })

  test("persists patch failures and threshold regeneration as workflow sub-attempts", async () => {
    // given
    dispatchSubagent = async (call) => {
      const payload = parseDispatchedPayload(call.prompt)
      if (call.agentToUse === "solver-markdown") {
        return { ok: true, sessionID: `solver-${String(payload.review_round ?? 1)}`, text: createCharacterizationArtifacts() }
      }
      if (call.agentToUse === "solver-markdown-patch") {
        return { ok: true, sessionID: `patch-${String(payload.review_round)}`, text: "not-json" }
      }
      if (call.agentToUse === "reference-reviewer-markdown") {
        const verdict = payload.review_round === 4 ? "[CORRECT]" : "[ERROR]"
        return { ok: true, sessionID: `review-${String(payload.review_round)}`, text: createReviewResult(payload, verdict) }
      }
      return { ok: false, error: `Unexpected agent ${call.agentToUse}` }
    }
    const tool = createOpenMathSolveOnlyTool({
      directory,
      client: Object.create(null),
      openmathConfig: {
        artifacts: { format: "markdown", patch: { max_ops: 7, allow_unique_substring_replace: false } },
        max_review_rounds: 4,
        max_consecutive_patch_failures: 2,
      },
    })

    // when
    const result = JSON.parse(String(await tool.execute({
      session_id: "root",
      problems: [{ id: "p1", problem: "Prove the result." }],
    }, context)))
    const workflow = await readWorkflowState(directory, "root::p1")

    // then
    expect(result.results[0]).toMatchObject({ rounds_used: 4, verdict: "[CORRECT]" })
    expect(workflow.kind).toBe("ok")
    if (workflow.kind !== "ok") throw new Error(workflow.message)
    expect(workflow.state.legacy_projection).toMatchObject({
      kind: "solve_only",
      markdown_fallback: {
        max_consecutive_patch_failures: 2,
        max_ops: 7,
        allow_unique_substring_replace: false,
        consecutive_failures: 0,
        last_error_code: null,
        regenerate_next: false,
        sub_attempt_history: [
          { kind: "patch", review_round: 2, outcome: "FAILED", error_code: "PATCH_OUTPUT_INVALID" },
          { kind: "patch", review_round: 3, outcome: "FAILED", error_code: "PATCH_OUTPUT_INVALID" },
          { kind: "regeneration", review_round: 4, outcome: "COMPLETED", error_code: null },
        ],
      },
    })
    expect(workflow.state.stage_history.map((record) => record.stage)).toEqual([
      "SOLVE",
      "REVIEW",
      "REVISE",
      "REVISE",
      "REVISE",
      "REVIEW",
    ])
  })
})
