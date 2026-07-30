import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { getOpenMathStateFilePath, readOpenMathSessionState } from "../../openmath/storage"
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

describe("solve-only workflow engine compatibility", () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "openmath-solve-workflow-"))
  })

  afterEach(() => {
    mock.restore()
    rmSync(directory, { recursive: true, force: true })
  })

  test("routes markdown solve-only through the exact legacy profile and projects each review", async () => {
    // given
    dispatchSubagent = async (call) => {
      const payload = parseDispatchedPayload(call.prompt)
      if (call.agentToUse === "solver-markdown") {
        return { ok: true, sessionID: "solver", text: createCharacterizationArtifacts() }
      }
      if (call.agentToUse === "reference-reviewer-markdown") {
        return { ok: true, sessionID: "reviewer", text: createReviewResult(payload, "[CORRECT]") }
      }
      return { ok: false, error: `Unexpected agent ${call.agentToUse}` }
    }
    const tool = createOpenMathSolveOnlyTool({
      directory,
      client: Object.create(null),
      openmathConfig: { artifacts: { format: "markdown" } },
    })

    // when
    const rawResult = await tool.execute({
      session_id: "root",
      problems: [{ id: "p1", problem: "Prove the result." }],
    }, context)

    // then
    expect(JSON.parse(String(rawResult))).toEqual({
      ok: true,
      results: [{ id: "p1", session_id: "root::p1", rounds_used: 1, verdict: "[CORRECT]" }],
    })
    const workflow = await readWorkflowState(directory, "root::p1")
    expect(workflow.kind).toBe("ok")
    if (workflow.kind !== "ok") throw new Error(workflow.message)
    expect(workflow.state.profile_snapshot).toMatchObject({
      name: "legacy-educational-markdown",
      checkpoint: "none",
      solve: { agent: "solver-markdown", output_adapter: "legacy_omo_sections" },
      review: { agent: "reference-reviewer-markdown", output_adapter: "review_verdict_json" },
      revise: { agent: "solver-markdown-patch", output_adapter: "patch_set_json" },
    })
    expect(workflow.state.stage_history.map((record) => record.stage)).toEqual(["SOLVE", "REVIEW"])
    expect(workflow.state.dispatch_attempts.every((attempt) => attempt.phase === "COMMITTED")).toBe(true)
    expect(workflow.state.status).toBe("PASSED")

    const legacy = readOpenMathSessionState(directory, "root::p1")
    expect(legacy).toMatchObject({
      session_id: "root::p1",
      original_problem_text: "Prove the result.",
      artifact_state: "FROZEN",
      artifact_version: 1,
      review_round: 1,
      max_review_rounds: 3,
      hint_budget_state: { hints_used: 0, hint_budget: 3 },
    })
    expect(legacy?.frozen_artifacts?.review_certificate.verdict).toBe("[CORRECT]")
  })

  test("runs solve review revise review sequentially inside one workflow", async () => {
    // given
    const calls: string[] = []
    dispatchSubagent = async (call) => {
      const payload = parseDispatchedPayload(call.prompt)
      calls.push(call.agentToUse)
      if (call.agentToUse === "solver-markdown") {
        return { ok: true, sessionID: "solver", text: createCharacterizationArtifacts() }
      }
      if (call.agentToUse === "solver-markdown-patch") {
        return { ok: true, sessionID: "reviser", text: JSON.stringify({ base_hash: payload.base_hash, ops: [] }) }
      }
      if (call.agentToUse === "reference-reviewer-markdown") {
        const verdict = payload.review_round === 1 ? "[ERROR]" : "[CORRECT]"
        return { ok: true, sessionID: `reviewer-${String(payload.review_round)}`, text: createReviewResult(payload, verdict) }
      }
      return { ok: false, error: `Unexpected agent ${call.agentToUse}` }
    }
    const tool = createOpenMathSolveOnlyTool({
      directory,
      client: Object.create(null),
      openmathConfig: { artifacts: { format: "markdown" }, max_review_rounds: 3 },
    })

    // when
    const rawResult = await tool.execute({
      session_id: "root",
      problems: [{ id: "p2", problem: "Prove the result." }],
    }, context)
    const workflow = await readWorkflowState(directory, "root::p2")

    // then
    expect(JSON.parse(String(rawResult))).toEqual({
      ok: true,
      results: [{ id: "p2", session_id: "root::p2", rounds_used: 2, verdict: "[CORRECT]" }],
    })
    expect(calls).toEqual(["solver-markdown", "reference-reviewer-markdown", "solver-markdown-patch", "reference-reviewer-markdown"])
    expect(workflow.kind === "ok" ? workflow.state.stage_history.map((record) => record.stage) : workflow).toEqual([
      "SOLVE",
      "REVIEW",
      "REVISE",
      "REVIEW",
    ])
  })

  test("imports a preexisting legacy state once without changing its public projection", async () => {
    // given
    const source = readFileSync(join(import.meta.dir, "..", "..", "openmath", "fixtures", "legacy-frozen-session.json"))
    const legacyPath = getOpenMathStateFilePath(directory, "legacy::lesson-7")
    mkdirSync(dirname(legacyPath), { recursive: true })
    writeFileSync(legacyPath, source)
    dispatchSubagent = async () => {
      throw new Error("A frozen imported workflow must not dispatch")
    }
    const tool = createOpenMathSolveOnlyTool({
      directory,
      client: Object.create(null),
      openmathConfig: { artifacts: { format: "json" } },
    })

    // when
    const first = await tool.execute({
      session_id: "legacy",
      problems: [{ id: "lesson-7", problem: "Solve x + 1 = 2." }],
    }, context)
    const second = await tool.execute({
      session_id: "legacy",
      problems: [{ id: "lesson-7", problem: "Solve x + 1 = 2." }],
    }, context)
    const workflow = await readWorkflowState(directory, "legacy::lesson-7")

    // then
    expect(JSON.parse(String(first))).toEqual(JSON.parse(String(second)))
    expect(JSON.parse(String(first))).toEqual({
      ok: true,
      results: [{ id: "lesson-7", session_id: "legacy::lesson-7", rounds_used: 2, verdict: "[CORRECT]" }],
    })
    expect(workflow.kind).toBe("ok")
    if (workflow.kind !== "ok") throw new Error(workflow.message)
    expect(workflow.state.legacy_source_hash).toBe(createHash("sha256").update(source).digest("hex"))
    expect(readOpenMathSessionState(directory, "legacy::lesson-7")).toEqual(JSON.parse(source.toString("utf8")))
  })
})
