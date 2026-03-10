import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createInitialOpenMathSessionState } from "./state"
import {
  getOpenMathStateFilePath,
  readOpenMathSessionState,
  writeOpenMathSessionState,
} from "./storage"

describe("openmath storage", () => {
  const TEST_DIR = join(tmpdir(), "openmath-state-test-" + Date.now())

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

  test("returns null when session file does not exist", () => {
    const result = readOpenMathSessionState(TEST_DIR, "ses-missing")
    expect(result).toBeNull()
  })

  test("writes and reads session state by session id", () => {
    const state = createInitialOpenMathSessionState("ses-1")
    state.hint_budget_state.hints_used = 1

    const writeSuccess = writeOpenMathSessionState(TEST_DIR, state)
    const readBack = readOpenMathSessionState(TEST_DIR, "ses-1")

    expect(writeSuccess).toBe(true)
    expect(readBack).not.toBeNull()
    expect(readBack?.session_id).toBe("ses-1")
    expect(readBack?.hint_budget_state.hints_used).toBe(1)
    expect(readBack?.artifact_state).toBe("DRAFT")
  })

  test("returns null when file content is invalid JSON", () => {
    const filePath = getOpenMathStateFilePath(TEST_DIR, "ses-1")
    const parentDir = join(TEST_DIR, ".sisyphus", "openmath-state")
    mkdirSync(parentDir, { recursive: true })
    writeFileSync(filePath, "{not-json", "utf-8")

    const result = readOpenMathSessionState(TEST_DIR, "ses-1")
    expect(result).toBeNull()
  })

  test("returns null when required fields are missing", () => {
    const filePath = getOpenMathStateFilePath(TEST_DIR, "ses-1")
    const parentDir = join(TEST_DIR, ".sisyphus", "openmath-state")
    mkdirSync(parentDir, { recursive: true })
    writeFileSync(filePath, JSON.stringify({ session_id: "ses-1" }), "utf-8")

    const result = readOpenMathSessionState(TEST_DIR, "ses-1")
    expect(result).toBeNull()
  })

  test("writes windows-compatible file name when mode is windows", () => {
    const state = createInitialOpenMathSessionState("root::p1")

    const writeSuccess = writeOpenMathSessionState(TEST_DIR, state, "windows")
    const windowsPath = getOpenMathStateFilePath(TEST_DIR, "root::p1", "windows")
    const linuxPath = getOpenMathStateFilePath(TEST_DIR, "root::p1", "linux")

    expect(writeSuccess).toBe(true)
    expect(windowsPath.endsWith("root_x3A__x3A_p1.json")).toBe(true)
    expect(existsSync(windowsPath)).toBe(true)
    expect(existsSync(linuxPath)).toBe(false)
    expect(readFileSync(windowsPath, "utf-8")).toContain('"session_id": "root::p1"')
  })

  test("reads windows-mode file through fallback when mode is linux", () => {
    const state = createInitialOpenMathSessionState("root::p2")
    const writeSuccess = writeOpenMathSessionState(TEST_DIR, state, "windows")

    const readBack = readOpenMathSessionState(TEST_DIR, "root::p2", "linux")

    expect(writeSuccess).toBe(true)
    expect(readBack).not.toBeNull()
    expect(readBack?.session_id).toBe("root::p2")
  })

  test("reads legacy percent-encoded windows file through fallback", () => {
    const state = createInitialOpenMathSessionState("root::p3")
    const parentDir = join(TEST_DIR, ".sisyphus", "openmath-state")
    const legacyPath = join(parentDir, "root%3A%3Ap3.json")

    mkdirSync(parentDir, { recursive: true })
    writeFileSync(legacyPath, JSON.stringify(state, null, 2), "utf-8")

    const readBack = readOpenMathSessionState(TEST_DIR, "root::p3", "windows")

    expect(readBack).not.toBeNull()
    expect(readBack?.session_id).toBe("root::p3")
  })
})
