import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import * as fs from "node:fs"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createInitialOpenMathSessionState } from "./state"

let rejectRawLinuxProblemPath = false

const originalWriteFileSync = fs.writeFileSync.bind(fs)

mock.module("node:fs", () => ({
  ...fs,
  writeFileSync: (filePath: fs.PathOrFileDescriptor, data: string | NodeJS.ArrayBufferView, options?: unknown) => {
    if (
      rejectRawLinuxProblemPath
      && typeof filePath === "string"
      && filePath.includes(`${join(".sisyphus", "openmath-state", "root::p1.json")}`)
    ) {
      const error = new Error("Invalid filename") as NodeJS.ErrnoException
      error.code = "EINVAL"
      throw error
    }
    return originalWriteFileSync(filePath, data, options as never)
  },
}))

describe("openmath storage write fallback", () => {
  let testDir: string

  beforeEach(() => {
    rejectRawLinuxProblemPath = false
    testDir = mkdtempSync(join(tmpdir(), "openmath-state-write-fallback-"))
  })

  afterEach(() => {
    rejectRawLinuxProblemPath = false
    rmSync(testDir, { recursive: true, force: true })
  })

  afterAll(() => {
    mock.restore()
  })

  test("falls back to windows-safe filename when linux-mode write fails for root::problem ids", async () => {
    const { getOpenMathStateFilePath, readOpenMathSessionState, writeOpenMathSessionState } = await import("./storage")

    rejectRawLinuxProblemPath = true
    const state = createInitialOpenMathSessionState("root::p1")

    const writeSuccess = writeOpenMathSessionState(testDir, state, "linux")
    const linuxPath = getOpenMathStateFilePath(testDir, "root::p1", "linux")
    const windowsPath = getOpenMathStateFilePath(testDir, "root::p1", "windows")
    const readBack = readOpenMathSessionState(testDir, "root::p1", "linux")

    expect(writeSuccess).toBe(true)
    expect(existsSync(linuxPath)).toBe(false)
    expect(existsSync(windowsPath)).toBe(true)
    expect(readBack?.session_id).toBe("root::p1")
  })
})
