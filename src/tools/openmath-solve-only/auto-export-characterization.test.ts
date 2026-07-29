import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import type { ToolContext } from "@opencode-ai/plugin/tool"
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

const context = {
  sessionID: "parent-session",
  messageID: "message",
  agent: "test-agent",
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
} satisfies ToolContext

describe("solve-only auto-export compatibility", () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "openmath-auto-export-characterization-"))
  })

  afterEach(() => {
    mock.restore()
    rmSync(directory, { recursive: true, force: true })
  })

  test("returns existing exported paths after freezing artifacts", async () => {
    //#given
    dispatchSubagent = async (call) => {
      if (call.agentToUse === "solver-markdown") {
        return { ok: true, sessionID: "solver", text: createCharacterizationArtifacts() }
      }
      if (call.agentToUse === "reference-reviewer-markdown") {
        const payload = parseDispatchedPayload(call.prompt)
        return { ok: true, sessionID: "reviewer", text: createReviewResult(payload, "[CORRECT]") }
      }
      return { ok: false, error: `Unexpected agent ${call.agentToUse}` }
    }
    const exportDir = join(directory, "exports")
    const tool = createOpenMathSolveOnlyTool({
      directory,
      client: Object.create(null),
      openmathConfig: {
        artifacts: { format: "markdown" },
        export: { allowed_base_dirs: [directory], overwrite: false },
      },
    })

    //#when
    const result = JSON.parse(String(await tool.execute({
      session_id: "root",
      auto_export: true,
      export_dir: exportDir,
      problems: [{ id: "p1", problem: "Prove it.", prefix: "lesson-7" }],
    }, context)))

    //#then
    expect(result).toEqual({
      ok: true,
      results: [{
        id: "p1",
        session_id: "root::p1",
        rounds_used: 1,
        verdict: "[CORRECT]",
        exported: {
          student_path: join(exportDir, "lesson-7_solution_for_student.md"),
          teacher_path: join(exportDir, "lesson-7_solution_for_teacher.md"),
        },
      }],
    })
    expect(existsSync(result.results[0].exported.student_path)).toBe(true)
    expect(existsSync(result.results[0].exported.teacher_path)).toBe(true)
  })
})
