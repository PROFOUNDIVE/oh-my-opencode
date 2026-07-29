import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { getOpenMathStateDirectory, getOpenMathStateFilePath, readOpenMathSessionState } from "./storage"

const SESSION_ID = "legacy::lesson-7"
const fixturePath = join(import.meta.dir, "fixtures", "legacy-frozen-session.json")

describe("legacy frozen state filename compatibility", () => {
  let directory: string
  let fixture: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "openmath-storage-legacy-"))
    fixture = readFileSync(fixturePath, "utf8")
    mkdirSync(getOpenMathStateDirectory(directory), { recursive: true })
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  test("loads a frozen educational artifact from the legacy Linux filename", () => {
    //#given
    writeFileSync(getOpenMathStateFilePath(directory, SESSION_ID, "linux"), fixture, "utf8")

    //#when
    const state = readOpenMathSessionState(directory, SESSION_ID, "linux")

    //#then
    expect(state?.artifact_state).toBe("FROZEN")
    expect(state?.frozen_artifacts?.reference_solution).toBe("Subtract 1 from both sides to obtain x = 1.")
  })

  test("loads the same frozen artifact from the Windows-safe filename", () => {
    //#given
    const statePath = getOpenMathStateFilePath(directory, SESSION_ID, "windows")
    writeFileSync(statePath, fixture, "utf8")

    //#when
    const state = readOpenMathSessionState(directory, SESSION_ID, "windows")

    //#then
    expect(statePath.endsWith("legacy_x3A__x3A_lesson-7.json")).toBe(true)
    expect(state?.frozen_artifacts?.variant_problem).toBe("Solve x + 2 = 5.")
  })

  test("falls back to the legacy percent-encoded filename", () => {
    //#given
    const legacyPath = join(getOpenMathStateDirectory(directory), `${encodeURIComponent(SESSION_ID)}.json`)
    writeFileSync(legacyPath, fixture, "utf8")

    //#when
    const state = readOpenMathSessionState(directory, SESSION_ID, "windows")

    //#then
    expect(state?.session_id).toBe(SESSION_ID)
    expect(state?.frozen_artifacts?.review_certificate.verdict).toBe("[CORRECT]")
  })
})
