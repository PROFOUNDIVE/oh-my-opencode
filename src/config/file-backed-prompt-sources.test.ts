import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import type { OhMyOpenCodeConfig } from "./schema"
import { mergeConfigs } from "../plugin-config"
import { recordPromptSourceDirectories } from "./prompt-source-directories"
import { getPromptSourceMetadata } from "./prompt-source-directories"
import { resolveFileBackedPromptSources } from "./file-backed-prompt-sources"

describe("resolveFileBackedPromptSources", () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "file-backed-prompt-sources-"))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  test("resolves winning agent and category file sources before bespoke agent builders", () => {
    //#given
    const userDirectory = join(directory, "user")
    const projectDirectory = join(directory, "project")
    mkdirSync(userDirectory)
    mkdirSync(projectDirectory)
    writeFileSync(join(userDirectory, "replacement.md"), "user replacement", "utf8")
    writeFileSync(join(userDirectory, "append.md"), "user append", "utf8")
    writeFileSync(join(userDirectory, "category.md"), "user category append", "utf8")
    const userConfig = {
      agents: {
        solver: {
          prompt: "file://./replacement.md",
          prompt_append: "file://./append.md",
        },
      },
      categories: {
        quick: { prompt_append: "file://./category.md" },
      },
    } satisfies OhMyOpenCodeConfig
    const projectConfig = {
      agents: { solver: { temperature: 0.3 } },
      categories: { quick: { temperature: 0.3 } },
    } satisfies OhMyOpenCodeConfig
    recordPromptSourceDirectories(userConfig, userDirectory)
    recordPromptSourceDirectories(projectConfig, projectDirectory)
    const merged = mergeConfigs(userConfig, projectConfig)

    //#when
    const resolved = resolveFileBackedPromptSources(merged)

    //#then
    expect(resolved.agents?.solver?.prompt).toBe("user replacement")
    expect(resolved.agents?.solver?.prompt_append).toBe("user append")
    expect(resolved.categories?.quick?.prompt_append).toBe("user category append")
  })

  test("retains source metadata and composes selected bespoke category appends", () => {
    //#given
    const userDirectory = join(directory, "metadata-user")
    const projectDirectory = join(directory, "metadata-project")
    mkdirSync(userDirectory)
    mkdirSync(projectDirectory)
    const replacementPath = join(userDirectory, "replacement.md")
    writeFileSync(replacementPath, "REPLACEMENT_V1", "utf8")
    writeFileSync(join(userDirectory, "category.md"), "CATEGORY_APPEND", "utf8")
    writeFileSync(join(userDirectory, "junior.md"), "JUNIOR_APPEND", "utf8")
    writeFileSync(join(userDirectory, "prometheus.md"), "PROMETHEUS_APPEND", "utf8")
    const userConfig = {
      agents: {
        solver: { prompt: "file://./replacement.md" },
        "sisyphus-junior": { category: "quick", prompt_append: "file://./junior.md" },
        prometheus: { category: "quick", prompt_append: "file://./prometheus.md" },
      },
      categories: { quick: { prompt_append: "file://./category.md" } },
    } satisfies OhMyOpenCodeConfig
    const projectConfig = {
      agents: { solver: { temperature: 0.3 } },
      categories: { quick: { temperature: 0.3 } },
    } satisfies OhMyOpenCodeConfig
    recordPromptSourceDirectories(userConfig, userDirectory)
    recordPromptSourceDirectories(projectConfig, projectDirectory)
    const merged = mergeConfigs(userConfig, projectConfig)

    //#when
    const resolved = resolveFileBackedPromptSources(merged)
    writeFileSync(replacementPath, "REPLACEMENT_V2", "utf8")
    const solver = resolved.agents?.solver
    const junior = resolved.agents?.["sisyphus-junior"]
    const prometheus = resolved.agents?.prometheus
    const category = resolved.categories?.quick
    if (!solver || !junior || !prometheus || !category) throw new Error("Expected resolved sources")
    const promptSources = getPromptSourceMetadata(solver, "prompt")
    const categorySources = getPromptSourceMetadata(category, "prompt_append")
    const juniorSources = getPromptSourceMetadata(junior, "prompt_append")
    const prometheusSources = getPromptSourceMetadata(prometheus, "prompt_append")

    //#then
    expect(solver.prompt).toBe("REPLACEMENT_V1")
    expect(promptSources).toHaveLength(1)
    expect(promptSources[0]?.originalUri).toBe("file://./replacement.md")
    expect(promptSources[0]?.baseDirectory).toBe(userDirectory)
    expect(promptSources[0]?.resolvedPath).toBe(replacementPath)
    expect(promptSources[0]?.canonicalPath).toBe(replacementPath)
    expect(promptSources[0]?.content).toBe("REPLACEMENT_V1")
    expect(promptSources[0]?.sha256).toBe(
      createHash("sha256").update("REPLACEMENT_V1", "utf8").digest("hex"),
    )
    expect(categorySources[0]?.originalUri).toBe("file://./category.md")
    expect(categorySources[0]?.baseDirectory).toBe(userDirectory)
    expect(categorySources[0]?.resolvedPath).toBe(join(userDirectory, "category.md"))
    expect(categorySources[0]?.content).toBe("CATEGORY_APPEND")
    expect(junior.prompt_append).toBe("CATEGORY_APPEND\nJUNIOR_APPEND")
    expect(prometheus.prompt_append).toBe("CATEGORY_APPEND\nPROMETHEUS_APPEND")
    expect(juniorSources.map((source) => source.originalUri)).toEqual([
      "file://./category.md",
      "file://./junior.md",
    ])
    expect(juniorSources.map((source) => source.content)).toEqual([
      "CATEGORY_APPEND",
      "JUNIOR_APPEND",
    ])
    expect(prometheusSources.map((source) => source.originalUri)).toEqual([
      "file://./category.md",
      "file://./prometheus.md",
    ])
  })
})
