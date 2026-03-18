import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { createInitialOpenMathSessionState } from "./state"
import { readOpenMathSessionState, writeOpenMathSessionState } from "./storage"

describe("openmath storage original_problem_text", () => {
  const TEST_DIR = join(tmpdir(), "openmath-state-original-problem-test-" + Date.now())

  beforeEach(() => {
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true })
    }
  })

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true })
    }
  })

  test("round-trips normalized original problem text", () => {
    const state = createInitialOpenMathSessionState("ses-1")
    state.original_problem_text = "prefix line\nx+1=2"

    const writeSuccess = writeOpenMathSessionState(TEST_DIR, state)
    const readBack = readOpenMathSessionState(TEST_DIR, "ses-1")

    expect(writeSuccess).toBe(true)
    expect(readBack).not.toBeNull()
    expect(readBack?.original_problem_text).toBe("prefix line\nx+1=2")
  })

  test("accepts legacy state without original_problem_text", () => {
    const state = createInitialOpenMathSessionState("ses-legacy")

    const writeSuccess = writeOpenMathSessionState(TEST_DIR, state)
    const readBack = readOpenMathSessionState(TEST_DIR, "ses-legacy")

    expect(writeSuccess).toBe(true)
    expect(readBack).not.toBeNull()
    expect(readBack?.original_problem_text).toBeUndefined()
  })
})
