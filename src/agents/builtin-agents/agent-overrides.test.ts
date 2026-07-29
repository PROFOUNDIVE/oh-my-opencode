import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentOverrideConfig } from "../types"
import { loadConfigFromPath, mergeConfigs } from "../../plugin-config"
import { applyCategoryOverride, applyOverrides, mergeAgentConfig } from "./agent-overrides"

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

  test("replaces the factory prompt from a file URI before appending", () => {
    //#given
    writeFileSync(join(directory, "replacement.md"), "file replacement", "utf8")
    const base = { prompt: "factory prompt" } satisfies AgentConfig
    const override = {
      prompt: "file://./replacement.md",
      prompt_append: "inline append",
    } satisfies AgentOverrideConfig

    //#when
    const merged = mergeAgentConfig(base, override, directory)

    //#then
    expect(merged.prompt).toBe("file replacement\ninline append")
  })

  test("uses the winning user source directory for file-backed agent prompts", () => {
    //#given
    const userDirectory = join(directory, "user")
    const projectDirectory = join(directory, "project")
    mkdirSync(userDirectory)
    mkdirSync(projectDirectory)
    writeFileSync(join(userDirectory, "replacement.md"), "user replacement", "utf8")
    writeFileSync(join(userDirectory, "append.md"), "user append", "utf8")
    writeFileSync(
      join(userDirectory, "oh-my-openmath.json"),
      JSON.stringify({
        agents: {
          solver: {
            prompt: "file://./replacement.md",
            prompt_append: "file://./append.md",
          },
        },
      }),
      "utf8",
    )
    writeFileSync(
      join(projectDirectory, "oh-my-openmath.json"),
      JSON.stringify({ agents: { solver: { temperature: 0.3 } } }),
      "utf8",
    )
    const userConfig = loadConfigFromPath(join(userDirectory, "oh-my-openmath.json"), {})
    const projectConfig = loadConfigFromPath(join(projectDirectory, "oh-my-openmath.json"), {})
    if (!userConfig || !projectConfig) throw new Error("Expected both configs to load")

    //#when
    const mergedConfig = mergeConfigs(userConfig, projectConfig)
    const override = mergedConfig.agents?.solver
    if (!override) throw new Error("Expected merged solver override")
    const merged = applyOverrides(
      { prompt: "factory prompt" },
      override,
      {},
      projectDirectory,
    )

    //#then
    expect(merged.prompt).toBe("user replacement\nuser append")
  })

  test("uses the winning project source directory for file-backed agent prompts", () => {
    //#given
    const userDirectory = join(directory, "user-winning")
    const projectDirectory = join(directory, "project-winning")
    mkdirSync(userDirectory)
    mkdirSync(projectDirectory)
    writeFileSync(join(userDirectory, "replacement.md"), "user replacement", "utf8")
    writeFileSync(join(projectDirectory, "replacement.md"), "project replacement", "utf8")
    writeFileSync(join(projectDirectory, "append.md"), "project append", "utf8")
    writeFileSync(
      join(userDirectory, "oh-my-openmath.json"),
      JSON.stringify({ agents: { solver: { prompt: "file://./replacement.md" } } }),
      "utf8",
    )
    writeFileSync(
      join(projectDirectory, "oh-my-openmath.json"),
      JSON.stringify({
        agents: {
          solver: {
            prompt: "file://./replacement.md",
            prompt_append: "file://./append.md",
          },
        },
      }),
      "utf8",
    )
    const userConfig = loadConfigFromPath(join(userDirectory, "oh-my-openmath.json"), {})
    const projectConfig = loadConfigFromPath(join(projectDirectory, "oh-my-openmath.json"), {})
    if (!userConfig || !projectConfig) throw new Error("Expected both configs to load")

    //#when
    const mergedConfig = mergeConfigs(userConfig, projectConfig)
    const override = mergedConfig.agents?.solver
    if (!override) throw new Error("Expected merged solver override")
    const merged = applyOverrides({ prompt: "factory prompt" }, override, {}, userDirectory)

    //#then
    expect(merged.prompt).toBe("project replacement\nproject append")
  })

  test("uses the winning user source directory for file-backed category appends", () => {
    //#given
    const userDirectory = join(directory, "user-category")
    const projectDirectory = join(directory, "project-category")
    mkdirSync(userDirectory)
    mkdirSync(projectDirectory)
    writeFileSync(join(userDirectory, "append.md"), "user category append", "utf8")
    writeFileSync(
      join(userDirectory, "oh-my-openmath.json"),
      JSON.stringify({ categories: { quick: { prompt_append: "file://./append.md" } } }),
      "utf8",
    )
    writeFileSync(
      join(projectDirectory, "oh-my-openmath.json"),
      JSON.stringify({ categories: { quick: { temperature: 0.3 } } }),
      "utf8",
    )
    const userConfig = loadConfigFromPath(join(userDirectory, "oh-my-openmath.json"), {})
    const projectConfig = loadConfigFromPath(join(projectDirectory, "oh-my-openmath.json"), {})
    if (!userConfig || !projectConfig) throw new Error("Expected both configs to load")

    //#when
    const mergedConfig = mergeConfigs(userConfig, projectConfig)
    const categories = mergedConfig.categories
    if (!categories) throw new Error("Expected merged categories")
    const merged = applyCategoryOverride(
      { prompt: "factory prompt" },
      "quick",
      categories,
    )

    //#then
    expect(merged.prompt).toBe("factory prompt\nuser category append")
  })
})
