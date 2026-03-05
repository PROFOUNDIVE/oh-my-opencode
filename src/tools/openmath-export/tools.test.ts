/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { writeOpenMathSessionState } from "../../openmath/storage"
import { createInitialOpenMathSessionState } from "../../openmath/state"
import type { FrozenArtifacts } from "../../openmath/types"
import { createOpenMathExportTool } from "./tools"

const mockContext = {
  sessionID: "test-session",
  messageID: "test-message",
  agent: "test-agent",
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
} as unknown as ToolContext

function createFrozenArtifacts(overrides?: Partial<FrozenArtifacts>): FrozenArtifacts {
  return {
    reference_solution: "\\(x=1\\)",
    hint_ladder: {
      L1_nudge: "Try isolating x",
      L2_key_theorem: "Use basic algebraic rearrangement",
      L3_skeleton: ["Subtract 1 from both sides", "Divide both sides by the coefficient of x"],
      __orchestrator_state: { secret: "do-not-leak" },
    },
    grading_rubric: {
      key_theorem: "Algebra",
      key_technique: "Simplify",
      premises_check: ["Assumptions stated"],
      logical_steps: ["Rearrange", "Solve"],
      common_pitfalls: ["Sign error"],
      __orchestrator_state: { secret: "do-not-leak" },
    },
    variant_problem: "Solve for x in x+1=2.",
    review_certificate: {
      artifact_version: "v1",
      review_round: 1,
      timestamp: "1970-01-01T00:00:00.000Z",
      verdict: "[CORRECT]",
      notes: "ok",
    },
    ...overrides,
  }
}

describe("openmath_export tool", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "openmath-export-tool-test-"))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  test("writes student and teacher markdown exports from frozen artifacts and strips __* keys", async () => {
    //#given
    const exportDir = join(tempDir, "exports")
    const tool = createOpenMathExportTool(tempDir, {
      allowed_base_dirs: [tempDir],
      default_dir: exportDir,
      overwrite: false,
    })

    const state = createInitialOpenMathSessionState("ses-export")
    state.frozen_artifacts = createFrozenArtifacts()
    const writeOk = writeOpenMathSessionState(tempDir, state)
    expect(writeOk).toBe(true)

    //#when
    const result = await tool.execute({ session_id: "ses-export", prefix: "sec77" }, mockContext)

    //#then
    const parsed = JSON.parse(result as string)
    expect(parsed.ok).toBe(true)
    expect(parsed.student_path).toBe(join(exportDir, "sec77_solution_for_student.md"))
    expect(parsed.teacher_path).toBe(join(exportDir, "sec77_solution_for_teacher.md"))

    const student = readFileSync(parsed.student_path, "utf-8")
    const teacher = readFileSync(parsed.teacher_path, "utf-8")

    expect(student).toContain("# OpenMath hints (student)")
    expect(student).toContain("## Hint ladder")
    expect(student).toContain("### L1_nudge")
    expect(student).toContain("Try isolating x")
    expect(student).toContain("### L2_key_theorem")
    expect(student).toContain("Use basic algebraic rearrangement")
    expect(student).toContain("### L3_skeleton")
    expect(student).toContain("- Subtract 1 from both sides")
    expect(student).toContain("- Divide both sides by the coefficient of x")
    expect(student).not.toContain("## Reference solution")
    expect(student).not.toContain("## Grading rubric")
    expect(student).not.toContain("\\(x=1\\)")
    expect(student).not.toContain("## Variant problem")
    expect(student).not.toContain("## Review certificate")

    expect(teacher).toContain("# OpenMath solution (teacher)")
    expect(teacher).toContain("## Variant problem")
    expect(teacher).toContain("Solve for x")
    expect(teacher).toContain("## Review certificate")
    expect(teacher).toContain('"verdict": "[CORRECT]"')

    expect(student).not.toContain("__orchestrator_state")
    expect(teacher).not.toContain("__orchestrator_state")
    expect(student).not.toContain("do-not-leak")
    expect(teacher).not.toContain("do-not-leak")
  })

  test("refuses overwrite unless overwrite=true (or configured)", async () => {
    //#given
    const exportDir = join(tempDir, "exports")
    const tool = createOpenMathExportTool(tempDir, { allowed_base_dirs: [tempDir], default_dir: exportDir })

    const state = createInitialOpenMathSessionState("ses-overwrite")
    state.frozen_artifacts = createFrozenArtifacts({
      hint_ladder: {
        L1_nudge: "first",
        L2_key_theorem: "Use basic algebraic rearrangement",
        L3_skeleton: ["Subtract 1 from both sides", "Divide both sides by the coefficient of x"],
        __orchestrator_state: { secret: "do-not-leak" },
      },
    })
    expect(writeOpenMathSessionState(tempDir, state)).toBe(true)

    //#when
    const first = JSON.parse((await tool.execute({ session_id: "ses-overwrite", prefix: "p" }, mockContext)) as string)
    const second = JSON.parse((await tool.execute({ session_id: "ses-overwrite", prefix: "p" }, mockContext)) as string)

    //#then
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(false)
    expect(second.error_code).toBe("OVERWRITE_REFUSED")

    //#when
    state.frozen_artifacts = createFrozenArtifacts({
      hint_ladder: {
        L1_nudge: "second",
        L2_key_theorem: "Use basic algebraic rearrangement",
        L3_skeleton: ["Subtract 1 from both sides", "Divide both sides by the coefficient of x"],
        __orchestrator_state: { secret: "do-not-leak" },
      },
    })
    expect(writeOpenMathSessionState(tempDir, state)).toBe(true)
    const third = JSON.parse(
      (await tool.execute({ session_id: "ses-overwrite", prefix: "p", overwrite: true }, mockContext)) as string,
    )

    //#then
    expect(third.ok).toBe(true)
    const student = readFileSync(third.student_path, "utf-8")
    expect(student).toContain("second")
  })

  test("returns clear error when state is missing or frozen_artifacts is null", async () => {
    //#given
    const exportDir = join(tempDir, "exports")
    const tool = createOpenMathExportTool(tempDir, { allowed_base_dirs: [tempDir], default_dir: exportDir })

    //#when
    const missing = JSON.parse((await tool.execute({ session_id: "ses-missing", prefix: "x" }, mockContext)) as string)

    //#then
    expect(missing.ok).toBe(false)
    expect(missing.error_code).toBe("STATE_NOT_FOUND")

    //#given
    const state = createInitialOpenMathSessionState("ses-null")
    state.frozen_artifacts = null
    expect(writeOpenMathSessionState(tempDir, state)).toBe(true)

    //#when
    const nullArtifacts = JSON.parse(
      (await tool.execute({ session_id: "ses-null", prefix: "x" }, mockContext)) as string,
    )

    //#then
    expect(nullArtifacts.ok).toBe(false)
    expect(nullArtifacts.error_code).toBe("ARTIFACTS_MISSING")
  })

  test("refuses to write outside allowed_base_dirs", async () => {
    //#given
    const allowedBase = join(tempDir, "allowed")
    const notAllowedDir = join(tempDir, "not-allowed")
    const tool = createOpenMathExportTool(tempDir, { allowed_base_dirs: [allowedBase], default_dir: allowedBase })

    const state = createInitialOpenMathSessionState("ses-guard")
    state.frozen_artifacts = createFrozenArtifacts()
    expect(writeOpenMathSessionState(tempDir, state)).toBe(true)

    //#when
    const result = JSON.parse(
      (await tool.execute({ session_id: "ses-guard", dir: notAllowedDir, prefix: "x" }, mockContext)) as string,
    )

    //#then
    expect(result.ok).toBe(false)
    expect(result.error_code).toBe("PATH_NOT_ALLOWED")
  })

  test("expands ~ in dir and allowed_base_dirs", async () => {
    //#given
    const homeBase = mkdtempSync(join(homedir(), "openmath-export-home-"))
    try {
      const tildeHomeBase = homeBase.replace(homedir(), "~")
      const tool = createOpenMathExportTool(tempDir, { allowed_base_dirs: [tildeHomeBase], default_dir: tildeHomeBase })

      const state = createInitialOpenMathSessionState("ses-home")
      state.frozen_artifacts = createFrozenArtifacts()
      expect(writeOpenMathSessionState(tempDir, state)).toBe(true)

      //#when
      const result = JSON.parse((await tool.execute({ session_id: "ses-home", prefix: "h" }, mockContext)) as string)

      //#then
      expect(result.ok).toBe(true)
      expect(result.student_path.startsWith(homeBase)).toBe(true)
      expect(result.teacher_path.startsWith(homeBase)).toBe(true)
    } finally {
      rmSync(homeBase, { recursive: true, force: true })
    }
  })
})
