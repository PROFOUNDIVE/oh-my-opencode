import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import type { ToolContext } from "@opencode-ai/plugin/tool"
import {
  CHARACTERIZATION_REFS,
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

const context = {
  sessionID: "parent-session",
  messageID: "message",
  agent: "test-agent",
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
} satisfies ToolContext

describe("solve-only supplementary reference compatibility", () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "openmath-reference-characterization-"))
  })

  afterEach(() => {
    mock.restore()
    rmSync(directory, { recursive: true, force: true })
  })

  test("sends supplementary_refs to every legacy stage while one call consumes SOLVE REVIEW REVISE rounds", async () => {
    //#given
    const dispatchedPayloads = new Map<string, Record<string, unknown>[]>()
    dispatchSubagent = async (call) => {
      const payload = parseDispatchedPayload(call.prompt)
      const prior = dispatchedPayloads.get(call.agentToUse) ?? []
      dispatchedPayloads.set(call.agentToUse, [...prior, payload])

      if (call.agentToUse === "solver-markdown") {
        return { ok: true, sessionID: "solver-round-1", text: createCharacterizationArtifacts() }
      }
      if (call.agentToUse === "solver-markdown-patch") {
        return {
          ok: true,
          sessionID: "reviser-round-2",
          text: JSON.stringify({ base_hash: payload.base_hash, ops: [] }),
        }
      }
      if (call.agentToUse === "reference-reviewer-markdown") {
        const verdict = payload.review_round === 1 ? "[ERROR]" : "[CORRECT]"
        return { ok: true, sessionID: `reviewer-round-${payload.review_round}`, text: createReviewResult(payload, verdict) }
      }
      return { ok: false, error: `Unexpected agent ${call.agentToUse}` }
    }

    const tool = createOpenMathSolveOnlyTool({
      directory,
      client: Object.create(null),
      openmathConfig: { artifacts: { format: "markdown" }, max_review_rounds: 3 },
    })

    //#when
    const result = JSON.parse(String(await tool.execute({
      session_id: "root",
      supplementary_refs: [...CHARACTERIZATION_REFS],
      problems: [{ id: "p1", problem: "Prove the result." }],
    }, context)))

    //#then
    expect(dispatchedPayloads.get("solver-markdown")?.[0]?.supplementary_refs).toEqual(CHARACTERIZATION_REFS)
    expect(dispatchedPayloads.get("reference-reviewer-markdown")).toHaveLength(2)
    expect(dispatchedPayloads.get("reference-reviewer-markdown")?.map((payload) => payload.supplementary_refs)).toEqual([
      CHARACTERIZATION_REFS,
      CHARACTERIZATION_REFS,
    ])
    expect(dispatchedPayloads.get("solver-markdown-patch")?.[0]?.supplementary_refs).toEqual(CHARACTERIZATION_REFS)
    expect(result).toEqual({
      ok: true,
      results: [{ id: "p1", session_id: "root::p1", rounds_used: 2, verdict: "[CORRECT]" }],
    })
  })
})
