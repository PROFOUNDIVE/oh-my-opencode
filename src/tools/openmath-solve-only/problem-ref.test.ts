/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { ProblemRefNotFoundError, extractProblemFromText, resolveProblemRefToProblemText } from "./problem-ref"

describe("openmath-solve-only problem_ref", () => {
  let projectDir: string
  let outsideDir: string
  let fakeHome: string

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "openmath-problem-ref-project-"))
    outsideDir = mkdtempSync(join(tmpdir(), "openmath-problem-ref-outside-"))
    fakeHome = mkdtempSync(join(tmpdir(), "openmath-problem-ref-home-"))
  })

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true })
    rmSync(outsideDir, { recursive: true, force: true })
    rmSync(fakeHome, { recursive: true, force: true })
  })

  test("extracts N. blocks from markdown", () => {
    const text = ["1.", "First", "", "2.", "Second"].join("\n")
    const p1 = extractProblemFromText({ text, fileType: "md", problemNumber: 1 })
    const p2 = extractProblemFromText({ text, fileType: "md", problemNumber: 2 })

    expect(p1.ok).toBe(true)
    expect(p2.ok).toBe(true)

    if (p1.ok) {
      expect(p1.extracted).toBe(["1.", "First"].join("\n"))
    }
    if (p2.ok) {
      expect(p2.extracted).toBe(["2.", "Second"].join("\n"))
    }
  })

  test("extracts Problem N blocks from markdown headings", () => {
    const text = ["# Problem 3", "Statement", "", "# Problem 4", "Next"].join("\n")
    const p3 = extractProblemFromText({ text, fileType: "md", problemNumber: 3 })
    expect(p3.ok).toBe(true)
    if (p3.ok) {
      expect(p3.extracted).toBe(["# Problem 3", "Statement"].join("\n"))
    }
  })

  test("extracts Problem N blocks from tex section headers", () => {
    const text = ["\\section*{Problem 2}", "Tex statement", "\\section*{Problem 3}", "Next"].join("\n")
    const p2 = extractProblemFromText({ text, fileType: "tex", problemNumber: 2 })
    expect(p2.ok).toBe(true)
    if (p2.ok) {
      expect(p2.extracted).toBe(["\\section*{Problem 2}", "Tex statement"].join("\n"))
    }
  })

  test("fails closed on ambiguous matches", () => {
    const text = ["Problem 1", "A", "", "Problem 1", "B"].join("\n")
    const out = extractProblemFromText({ text, fileType: "md", problemNumber: 1 })
    expect(out.ok).toBe(false)
  })

  test("resolves @[file] path and reads from project directory", async () => {
    const filePath = join(projectDir, "sheet.md")
    writeFileSync(filePath, ["Problem 1", "Hello", "Problem 2", "World"].join("\n"), "utf-8")

    const out = await resolveProblemRefToProblemText({
      projectDir,
      problemRef: { file_path: "@[sheet.md]", problem_number: 2 },
    })

    expect(out.resolved_path).toBe(filePath)
    expect(out.problem).toBe(["Problem 2", "World"].join("\n"))
  })

  test("refuses file paths outside allowed roots", async () => {
    const filePath = join(outsideDir, "outside.md")
    writeFileSync(filePath, ["Problem 1", "Nope"].join("\n"), "utf-8")

    try {
      await resolveProblemRefToProblemText({
        projectDir,
        problemRef: { file_path: filePath, problem_number: 1 },
      })
      expect(true).toBe(false)
    } catch (error) {
      expect(error instanceof ProblemRefNotFoundError).toBe(true)
    }
  })

  test("allows reading from ~/test/openmath-test when present", async () => {
    const openmathTestDir = join(fakeHome, "test", "openmath-test")
    mkdirSync(openmathTestDir, { recursive: true })
    const filePath = join(openmathTestDir, "refs.tex")
    writeFileSync(filePath, ["\\section*{Problem 7}", "Allowed"].join("\n"), "utf-8")

    const out = await resolveProblemRefToProblemText({
      projectDir,
      homedirOverride: fakeHome,
      problemRef: { file_path: filePath, problem_number: 7 },
    })

    expect(out.resolved_path).toBe(filePath)
    expect(out.problem).toBe(["\\section*{Problem 7}", "Allowed"].join("\n"))
  })
})
