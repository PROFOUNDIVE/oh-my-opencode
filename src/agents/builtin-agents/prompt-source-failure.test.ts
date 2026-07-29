import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentOverrideConfig } from "../types"
import { mergeAgentConfig } from "./agent-overrides"
import {
  ReplacementPromptDiagnostic,
  resolvePromptAppend,
  resolveReplacementPrompt,
} from "./resolve-file-uri"

describe("file-backed replacement prompt failures", () => {
  let directory: string
  const base = { prompt: "factory prompt" } satisfies AgentConfig

  beforeEach(() => {
    directory = join(tmpdir(), `prompt-source-failure-${Date.now()}-${Math.random()}`)
    mkdirSync(directory)
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  test("returns a typed diagnostic for malformed replacement URIs", () => {
    //#given
    const override = { prompt: "file://%E0%A4%A" } satisfies AgentOverrideConfig

    //#when
    const resolve = () => mergeAgentConfig(base, override, directory)

    //#then
    expect(resolve).toThrow("ReplacementPromptDiagnostic")
    expect(getDiagnostic(() => resolveReplacementPrompt(override.prompt, directory)).code).toBe("malformed")
  })

  test("returns a typed diagnostic for missing replacement files", () => {
    //#given
    const override = { prompt: "file://./missing.md" } satisfies AgentOverrideConfig

    //#when
    const resolve = () => mergeAgentConfig(base, override, directory)

    //#then
    expect(resolve).toThrow("ReplacementPromptDiagnostic")
    expect(getDiagnostic(() => resolveReplacementPrompt(override.prompt, directory)).code).toBe("missing")
  })

  test("returns a typed diagnostic for non-regular replacement sources", () => {
    //#given
    mkdirSync(join(directory, "directory.md"))
    const override = { prompt: "file://./directory.md" } satisfies AgentOverrideConfig

    //#when
    const resolve = () => mergeAgentConfig(base, override, directory)

    //#then
    expect(resolve).toThrow("ReplacementPromptDiagnostic")
    expect(getDiagnostic(() => resolveReplacementPrompt(override.prompt, directory)).code).toBe("non_regular")
  })

  test("returns a typed diagnostic for unreadable replacement files", () => {
    //#given
    const sourcePath = join(directory, "unreadable.md")
    writeFileSync(sourcePath, "unreadable", "utf8")
    chmodSync(sourcePath, 0o000)
    const override = { prompt: "file://./unreadable.md" } satisfies AgentOverrideConfig

    //#when
    const resolve = () => mergeAgentConfig(base, override, directory)

    //#then
    expect(resolve).toThrow("ReplacementPromptDiagnostic")
    expect(getDiagnostic(() => resolveReplacementPrompt(override.prompt, directory)).code).toBe("unreadable")
  })

  test("returns a typed diagnostic for invalid UTF-8 replacement bytes", () => {
    //#given
    const sourcePath = join(directory, "invalid-utf8.md")
    writeFileSync(sourcePath, Buffer.from([0xff]))
    const source = "file://./invalid-utf8.md"

    //#when
    const diagnostic = getDiagnostic(() => resolveReplacementPrompt(source, directory))

    //#then
    expect(diagnostic.code).toBe("invalid_utf8")
  })

  test("preserves malformed and missing append warning bytes", () => {
    //#given
    const malformed = "file://%E0%A4%A"
    const missing = "file://./missing.md"

    //#when
    const malformedResult = resolvePromptAppend(malformed, directory)
    const missingResult = resolvePromptAppend(missing, directory)

    //#then
    expect(malformedResult).toBe("[WARNING: Malformed file URI (invalid percent-encoding): file://%E0%A4%A]")
    expect(missingResult).toBe("[WARNING: Could not resolve file URI: file://./missing.md]")
  })
})

function getDiagnostic(action: () => unknown): ReplacementPromptDiagnostic {
  try {
    action()
  } catch (error) {
    if (error instanceof ReplacementPromptDiagnostic) return error
    throw error
  }

  throw new Error("Expected ReplacementPromptDiagnostic")
}
