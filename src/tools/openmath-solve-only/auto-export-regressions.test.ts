import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import type { ToolContext } from "@opencode-ai/plugin/tool"
import { createInitialOpenMathSessionState } from "../../openmath/state"
import { writeOpenMathSessionState } from "../../openmath/storage"
import type { FrozenArtifacts } from "../../openmath/types"
import { formatOpenMathArtifactsMarkdown } from "../../openmath/artifacts-markdown/format"
import { createOpenMathExportTool } from "../openmath-export/tools"

let runSyncImpl: (args: any) => Promise<
  { ok: true; sessionID: string; text: string } | { ok: false; error: string; error_code?: string }
>

mock.module("./run-sync-subagent", () => ({
  runSyncSubagentText: (args: any) => runSyncImpl(args),
}))

import { createOpenMathSolveOnlyTool } from "./tools"

const mockContext = {
  sessionID: "opencode-parent-session",
  messageID: "test-message",
  agent: "test-agent",
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
} as unknown as ToolContext

function createMarkdownArtifacts(problemId: string): string {
  return formatOpenMathArtifactsMarkdown({
    reference_solution: `Solution for ${problemId}.`,
    hint_ladder: {
      L1_nudge: "n",
      L2_key_theorem: "t",
      L3_skeleton: ["s1"],
      L4_full_solution: "@REFERENCE_SOLUTION",
    },
    grading_rubric: {
      premises_check: ["p"],
      logical_steps: ["l"],
      common_pitfalls: ["c"],
      key_theorem: "k",
      key_technique: "m",
    },
    variant_problem: `Variant for ${problemId}.`,
  })
}

function parseRoundFromDescription(desc: string): number {
  const m = desc.match(/\(round\s+(\d+)\)/)
  return m ? Number(m[1]) : 1
}

function parseProblemIdFromDescription(desc: string): string {
  const m = desc.match(/(solve|review|patch)\s+([^\s]+)\s+\(round/)
  return m ? m[2] : "p"
}

function createFrozenArtifacts(): FrozenArtifacts {
  return {
    reference_solution: "x=1",
    hint_ladder: {
      L1_nudge: "n",
      L2_key_theorem: "t",
      L3_skeleton: ["s1"],
      L4_full_solution: "x=1",
      __orchestrator_state: { secret: "do-not-leak" },
    },
    grading_rubric: {
      premises_check: ["p"],
      logical_steps: ["l"],
      common_pitfalls: ["c"],
      key_theorem: "k",
      key_technique: "m",
      __orchestrator_state: { secret: "do-not-leak" },
    },
    variant_problem: "solve x+1=2",
    review_certificate: {
      artifact_version: "v1",
      review_round: 1,
      timestamp: "1970-01-01T00:00:00.000Z",
      verdict: "[CORRECT]",
    },
  }
}

describe("openmath_solve_only auto export regressions", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "openmath-solve-only-auto-export-test-"))
  })

  afterEach(() => {
    mock.restore()
    rmSync(tempDir, { recursive: true, force: true })
  })

  test("keeps auto-export and manual export in parity for original problem rendering", async () => {
    const exportDir = join(tempDir, "exports")

    runSyncImpl = async ({ agentToUse, description, prompt }) => {
      const problemId = parseProblemIdFromDescription(description)
      const round = parseRoundFromDescription(description)

      if (agentToUse === "solver-markdown") {
        return { ok: true, sessionID: `ses_${problemId}_${round}`, text: createMarkdownArtifacts(problemId) }
      }
      if (agentToUse === "reference-reviewer-markdown") {
        const req = JSON.parse(prompt)
        return {
          ok: true,
          sessionID: `ses_${problemId}_${round}_r`,
          text: JSON.stringify({
            verdict: "[CORRECT]",
            blocking_issues: [],
            checks_performed: ["spec"],
            certificate: { artifact_version: "v1", review_round: req.review_round, timestamp: "1970-01-01T00:00:00.000Z" },
            base_hash: req.base_hash,
          }),
        }
      }
      return { ok: false, error: `unexpected agent: ${agentToUse}` }
    }

    const solveTool = createOpenMathSolveOnlyTool({
      directory: tempDir,
      client: {} as any,
      openmathConfig: {
        artifacts: { format: "markdown" },
        export: { allowed_base_dirs: [tempDir], overwrite: true },
      },
    })

    const solveOut = JSON.parse(
      (await solveTool.execute(
        {
          session_id: "root",
          auto_export: true,
          export_dir: exportDir,
          problems: [{ id: "p1", prefix: "Given equation", problem: "x+1=2" }],
        },
        mockContext,
      )) as string,
    )

    const autoStudentPath = solveOut.results[0].exported.student_path
    const autoTeacherPath = solveOut.results[0].exported.teacher_path
    expect(existsSync(autoStudentPath)).toBe(true)
    expect(existsSync(autoTeacherPath)).toBe(true)

    const exportTool = createOpenMathExportTool(tempDir, {
      allowed_base_dirs: [tempDir],
      default_dir: exportDir,
      overwrite: true,
    })

    const manualOut = JSON.parse(
      (await exportTool.execute({
        session_id: "root::p1",
        prefix: "manual",
        dir: exportDir,
      }, mockContext)) as string,
    )

    const autoStudent = readFileSync(autoStudentPath, "utf-8")
    const autoTeacher = readFileSync(autoTeacherPath, "utf-8")
    const manualStudent = readFileSync(manualOut.student_path, "utf-8")
    const manualTeacher = readFileSync(manualOut.teacher_path, "utf-8")

    expect(autoStudent).toContain("## Original problem")
    expect(autoTeacher).toContain("## Original problem")
    expect(manualStudent).toContain("## Original problem")
    expect(manualTeacher).toContain("## Original problem")
    expect(autoStudent).toContain("Given equation\nx+1=2")
    expect(manualStudent).toContain("Given equation\nx+1=2")
  })

  test("does not crash when exporting legacy state without original_problem_text", async () => {
    const exportDir = join(tempDir, "exports")
    const state = createInitialOpenMathSessionState("legacy::p1")
    state.artifact_state = "FROZEN"
    state.frozen_artifacts = createFrozenArtifacts()
    expect(writeOpenMathSessionState(tempDir, state)).toBe(true)

    const exportTool = createOpenMathExportTool(tempDir, {
      allowed_base_dirs: [tempDir],
      default_dir: exportDir,
      overwrite: true,
    })

    const out = JSON.parse(
      (await exportTool.execute({
        session_id: "legacy::p1",
        prefix: "legacy",
        dir: exportDir,
      }, mockContext)) as string,
    )

    expect(out.ok).toBe(true)
    const student = readFileSync(out.student_path, "utf-8")
    const teacher = readFileSync(out.teacher_path, "utf-8")
    expect(student).not.toContain("## Original problem")
    expect(teacher).not.toContain("## Original problem")
  })
})
