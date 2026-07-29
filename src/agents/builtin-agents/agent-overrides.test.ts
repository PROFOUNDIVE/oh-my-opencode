import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentOverrideConfig } from "../types"
import { mergeAgentConfig } from "./agent-overrides"

describe("mergeAgentConfig prompt compatibility", () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "agent-overrides-characterization-"))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  test("applies an inline prompt replacement before appending inline instructions", () => {
    //#given
    const base = { prompt: "factory prompt" } satisfies AgentConfig
    const override = {
      prompt: "inline replacement",
      prompt_append: "inline append",
    } satisfies AgentOverrideConfig

    //#when
    const merged = mergeAgentConfig(base, override, directory)

    //#then
    expect(merged.prompt).toBe("inline replacement\ninline append")
  })

  test("appends file URI contents relative to the config directory", () => {
    //#given
    writeFileSync(join(directory, "append.md"), "file append", "utf8")
    const base = { prompt: "factory prompt" } satisfies AgentConfig
    const override = { prompt_append: "file://./append.md" } satisfies AgentOverrideConfig

    //#when
    const merged = mergeAgentConfig(base, override, directory)

    //#then
    expect(merged.prompt).toBe("factory prompt\nfile append")
  })
})
