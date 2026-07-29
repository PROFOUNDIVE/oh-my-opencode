import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import type { ToolContext } from "@opencode-ai/plugin/tool"
import { getOpenMathStateFilePath } from "../../openmath/storage"
import { createOpenMathExportTool } from "./tools"

const context = {
  sessionID: "parent-session",
  messageID: "message",
  agent: "test-agent",
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
} satisfies ToolContext

describe("legacy frozen educational artifact export compatibility", () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "openmath-export-legacy-"))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  test("exports the frozen legacy fixture without changing student and teacher boundaries", async () => {
    //#given
    const sessionId = "legacy::lesson-7"
    const statePath = getOpenMathStateFilePath(directory, sessionId)
    mkdirSync(join(directory, ".sisyphus", "openmath-state"), { recursive: true })
    writeFileSync(
      statePath,
      readFileSync(join(import.meta.dir, "..", "..", "openmath", "fixtures", "legacy-frozen-session.json"), "utf8"),
      "utf8",
    )
    const exportDir = join(directory, "exports")
    const tool = createOpenMathExportTool(directory, {
      allowed_base_dirs: [directory],
      default_dir: exportDir,
      overwrite: false,
    })

    //#when
    const result = JSON.parse(String(await tool.execute({ session_id: sessionId, prefix: "legacy-lesson" }, context)))

    //#then
    expect(result).toEqual({
      ok: true,
      student_path: join(exportDir, "legacy-lesson_solution_for_student.md"),
      teacher_path: join(exportDir, "legacy-lesson_solution_for_teacher.md"),
    })
    const student = readFileSync(result.student_path, "utf8")
    const teacher = readFileSync(result.teacher_path, "utf8")
    expect(student).toContain("Isolate the unknown.")
    expect(student).not.toContain("Subtract 1 from both sides to obtain x = 1.")
    expect(teacher).toContain("Subtract 1 from both sides to obtain x = 1.")
    expect(teacher).toContain("Solve x + 2 = 5.")
  })
})
