import { afterEach, beforeEach, expect, mock, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { readOpenMathSessionState } from "../../openmath/storage"
import type { ToolContextWithMetadata } from "../delegate-task/types"
import {
  createCharacterizationArtifacts,
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
  directory = mkdtempSync(join(tmpdir(), "openmath-legacy-metadata-"))
})

afterEach(() => {
  mock.restore()
  rmSync(directory, { recursive: true, force: true })
})

test("projects the exact reviewer certificate and markdown blocking metadata", async () => {
  // given
  const blockingIssues = [{ location: "reference_solution", type: "logic_error", fix_direction: "repair proof", evidence: "gap" }]
  dispatchSubagent = async (call) => {
    if (call.agentToUse === "solver-markdown") {
      return { ok: true, sessionID: "solve", text: createCharacterizationArtifacts() }
    }
    if (call.agentToUse === "reference-reviewer-markdown") {
      const payload = parseDispatchedPayload(call.prompt)
      return {
        ok: true,
        sessionID: "review",
        text: JSON.stringify({
          verdict: "[CORRECT]",
          blocking_issues: blockingIssues,
          checks_performed: ["logic"],
          certificate: {
            artifact_version: "reviewer-v7",
            review_round: payload.review_round,
            timestamp: "2030-01-02T03:04:05.000Z",
            notes: "human note",
          },
          base_hash: payload.base_hash,
        }),
      }
    }
    return { ok: false, error: `Unexpected agent ${call.agentToUse}` }
  }
  const tool = createOpenMathSolveOnlyTool({
    directory,
    client: Object.create(null),
    openmathConfig: { artifacts: { format: "markdown" } },
  })

  // when
  await tool.execute({ session_id: "root", problems: [{ id: "metadata", problem: "Prove it." }] }, context)
  const legacy = readOpenMathSessionState(directory, "root::metadata")

  // then
  expect(legacy?.frozen_artifacts?.review_certificate).toEqual({
    artifact_version: "reviewer-v7",
    review_round: 1,
    timestamp: "2030-01-02T03:04:05.000Z",
    verdict: "[CORRECT]",
    notes: "human note",
  })
  expect(legacy?.frozen_artifacts?.hint_ladder["__orchestrator_state"]).toMatchObject({
    last_blocking_issues: blockingIssues,
  })
})
