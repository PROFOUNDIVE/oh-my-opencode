/// <reference types="bun-types" />

import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { getOpenMathStateFilePath } from "../../openmath/storage"
import { createInitialOpenMathSessionState } from "../../openmath/state"
import { createOpenMathStateTools } from "./tools"

const mockContext = {
  sessionID: "test-session",
  messageID: "test-message",
  agent: "test-agent",
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
} as unknown as ToolContext

describe("openmath-state tools", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "openmath-tool-test-"))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  test("roundtrips state with set then get", async () => {
    //#given
    const tools = createOpenMathStateTools(tempDir)
    const state = createInitialOpenMathSessionState("ses-roundtrip")
    state.hint_budget_state.hints_used = 2

    //#when
    const setResult = await tools.openmath_state_set.execute({ state }, mockContext)
    const getResult = await tools.openmath_state_get.execute({ session_id: "ses-roundtrip" }, mockContext)

    //#then
    const parsedSet = JSON.parse(setResult as string)
    const parsedGet = JSON.parse(getResult as string)
    expect(parsedSet.ok).toBe(true)
    expect(parsedGet.state).not.toBeNull()
    expect(parsedGet.state.session_id).toBe("ses-roundtrip")
    expect(parsedGet.state.hint_budget_state.hints_used).toBe(2)
  })

  test("resets persisted state by session id", async () => {
    //#given
    const tools = createOpenMathStateTools(tempDir)
    const state = createInitialOpenMathSessionState("ses-reset")
    await tools.openmath_state_set.execute({ state }, mockContext)

    //#when
    const resetResult = await tools.openmath_state_reset.execute({ session_id: "ses-reset" }, mockContext)
    const getAfterReset = await tools.openmath_state_get.execute({ session_id: "ses-reset" }, mockContext)

    //#then
    const parsedReset = JSON.parse(resetResult as string)
    const parsedAfterReset = JSON.parse(getAfterReset as string)
    expect(parsedReset.ok).toBe(true)
    expect(parsedAfterReset.state).toBeNull()
  })

  test("bootstraps missing state when init_if_missing is true", async () => {
    //#given
    const tools = createOpenMathStateTools(tempDir, { max_review_rounds: 9 })

    //#when
    const bootstrapResult = await tools.openmath_state_get.execute(
      { session_id: "ses-bootstrap", init_if_missing: true },
      mockContext,
    )
    const getAfterBootstrap = await tools.openmath_state_get.execute(
      { session_id: "ses-bootstrap" },
      mockContext,
    )

    //#then
    const parsedBootstrap = JSON.parse(bootstrapResult as string)
    const parsedAfterBootstrap = JSON.parse(getAfterBootstrap as string)
    expect(parsedBootstrap.state).not.toBeNull()
    expect(parsedBootstrap.state.session_id).toBe("ses-bootstrap")
    expect(parsedBootstrap.state.max_review_rounds).toBe(9)
    expect(parsedAfterBootstrap.state).not.toBeNull()
    expect(parsedAfterBootstrap.state.max_review_rounds).toBe(9)
  })

  test("returns validation error for invalid state input", async () => {
    //#given
    const tools = createOpenMathStateTools(tempDir)

    //#when
    const result = await tools.openmath_state_set.execute(
      {
        state: {
          session_id: "ses-invalid",
        },
      },
      mockContext,
    )

    //#then
    const parsed = JSON.parse(result as string)
    expect(parsed.error).toBe("validation_error")
  })

  test("persists and resets using windows-compatible state filename mode", async () => {
    //#given
    const tools = createOpenMathStateTools(tempDir, { state_filename_mode: "windows" })
    const state = createInitialOpenMathSessionState("root::p1")

    //#when
    const setResult = await tools.openmath_state_set.execute({ state }, mockContext)
    const windowsPath = getOpenMathStateFilePath(tempDir, "root::p1", "windows")
    const linuxPath = getOpenMathStateFilePath(tempDir, "root::p1", "linux")
    const getResult = await tools.openmath_state_get.execute({ session_id: "root::p1" }, mockContext)

    //#then
    const parsedSet = JSON.parse(setResult as string)
    const parsedGet = JSON.parse(getResult as string)
    expect(parsedSet.ok).toBe(true)
    expect(existsSync(windowsPath)).toBe(true)
    expect(existsSync(linuxPath)).toBe(false)
    expect(parsedGet.state.session_id).toBe("root::p1")

    const resetResult = await tools.openmath_state_reset.execute({ session_id: "root::p1" }, mockContext)
    const parsedReset = JSON.parse(resetResult as string)
    expect(parsedReset.ok).toBe(true)
    expect(existsSync(windowsPath)).toBe(false)
  })
})
