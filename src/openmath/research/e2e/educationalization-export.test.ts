import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { createOpenMathExportTool } from "../../../tools/openmath-export"
import { createApprovedEducationalizationFixture } from "./educationalization-export-fixture"

const cleanups: Array<() => void> = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

describe("approved research educationalization export", () => {
  test("reuses the student and teacher renderer with stable frozen output", async () => {
    const harness = await createApprovedEducationalizationFixture()
    cleanups.push(harness.cleanup)
    if (harness.educationalized === null) throw new TypeError("Expected educationalization result")
    expect(harness.educationalized).toMatchObject({ ok: true, status: "FROZEN" })
    const exportDirectory = join(harness.directory, "exports")
    mkdirSync(exportDirectory)
    const exporter = createOpenMathExportTool(harness.directory, {
      allowed_base_dirs: [harness.directory],
    })

    const first = parse(await exporter.execute({
      research_educationalization_id: harness.educationalized.educationalization_id,
      dir: exportDirectory,
      prefix: "research-first",
    }, toolContext()))
    const second = parse(await exporter.execute({
      research_educationalization_id: harness.educationalized.educationalization_id,
      dir: exportDirectory,
      prefix: "research-second",
    }, toolContext()))

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    const firstStudent = readFileSync(first.student_path, "utf8")
    const firstTeacher = readFileSync(first.teacher_path, "utf8")
    expect(readFileSync(second.student_path, "utf8")).toBe(firstStudent)
    expect(readFileSync(second.teacher_path, "utf8")).toBe(firstTeacher)
    expect(firstStudent).toContain("Begin with the definition")
    expect(firstStudent).not.toContain("Theorem\nLemma\nClaim")
    expect(firstTeacher).toContain("Theorem\nLemma\nClaim\nDefinition\nImported\nComputation")
    expect(firstTeacher).toContain("Pedagogical PASS only")
    expect(firstTeacher).toContain("non-canonical")
    expect(firstTeacher).toContain('"verdict": "PEDAGOGICAL_PASS"')
    expect(firstTeacher).toContain('"campaign_id": "campaign-a"')
    expect(firstTeacher).toContain('"mathematical_correctness_certified": false')
    expect(firstTeacher).not.toContain('"verdict": "[CORRECT]"')
  })

  test("refuses export when generation has not reached pedagogical freeze", async () => {
    const harness = await createApprovedEducationalizationFixture({ malformed_generation: true })
    cleanups.push(harness.cleanup)
    if (harness.educationalized === null) throw new TypeError("Expected educationalization result")
    expect(harness.educationalized.ok).toBe(false)
    const exportDirectory = join(harness.directory, "exports")
    mkdirSync(exportDirectory)
    const exporter = createOpenMathExportTool(harness.directory, {
      allowed_base_dirs: [harness.directory],
    })

    const result = parse(await exporter.execute({
      research_educationalization_id: harness.educationalized.educationalization_id,
      dir: exportDirectory,
      prefix: "unfrozen",
    }, toolContext()))

    expect(result).toMatchObject({ ok: false, error_code: "ARTIFACTS_NOT_FROZEN" })
  })

  test("serializes concurrent educationalization and reuses the winner", async () => {
    const harness = await createApprovedEducationalizationFixture({ skip_educationalization: true })
    cleanups.push(harness.cleanup)

    const concurrent = await Promise.all([
      harness.educationalize.execute(harness.educationalizationInput, toolContext()),
      harness.educationalize.execute(harness.educationalizationInput, toolContext()),
    ])
    const results = concurrent.map(parse)
    const replay = parse(await harness.educationalize.execute(harness.educationalizationInput, toolContext()))

    expect(results.some((result) => result.status === "FROZEN")).toBe(true)
    expect(results.every((result) => result.status === "FROZEN" || result.error_code === "STALE_STATE_REVISION")).toBe(true)
    expect(replay).toMatchObject({ ok: true, status: "FROZEN" })
    expect(harness.control.dispatches).toBe(4)
  })
})

function parse(value: unknown) {
  return JSON.parse(String(value))
}

function toolContext() {
  return {
    sessionID: "ses_export1",
    messageID: "msg_export1",
    agent: "test",
    abort: new AbortController().signal,
  }
}
