import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { resolveAllowedRoots } from "../references/path-resolver"
import type { ResolvedAllowedRoots } from "../references/types"
import { ResearchPromptSourceSchema, resolveResearchPromptSnapshot } from "./role-settings"

describe("research role prompt resolution", () => {
  let directory: string
  let outsideDirectory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "openmath-research-role-"))
    outsideDirectory = mkdtempSync(join(tmpdir(), "openmath-research-role-outside-"))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
    rmSync(outsideDirectory, { recursive: true, force: true })
  })

  test("reads the allowed canonical prompt when its source symlink changes after validation", () => {
    // #given
    const allowedDirectory = join(directory, "allowed")
    const allowedPrompt = join(allowedDirectory, "allowed.md")
    const outsidePrompt = join(outsideDirectory, "outside.md")
    const source = join(directory, "prompt.md")
    mkdirSync(allowedDirectory)
    writeFileSync(allowedPrompt, "allowed bytes", "utf8")
    writeFileSync(outsidePrompt, "outside bytes", "utf8")
    symlinkSync(allowedPrompt, source)
    const roots = resolveAllowedRoots({
      projectDirectory: directory,
      configuredRoots: [allowedDirectory],
    })
    let symlinkChanged = false
    const allowedRoots: ResolvedAllowedRoots = {
      canonicalPaths: new Proxy(roots.canonicalPaths, {
        get(target, property, receiver) {
          if (property !== "some") return Reflect.get(target, property, receiver)
          return (predicate: (value: string, index: number, values: readonly string[]) => unknown) => {
            const allowed = target.some(predicate)
            unlinkSync(source)
            symlinkSync(outsidePrompt, source)
            symlinkChanged = true
            return allowed
          }
        },
      }),
    }

    // #when
    const snapshot = resolveResearchPromptSnapshot({
      prompt: ResearchPromptSourceSchema.parse({ kind: "file", uri: `file://${source}` }),
      directory,
      allowed_roots: allowedRoots,
      location: "strategies.direct",
    })

    // #then
    if (snapshot.kind !== "file") throw new TypeError("Expected a file prompt snapshot")
    expect(symlinkChanged).toBe(true)
    expect(snapshot.canonical_path).toBe(allowedPrompt)
    expect(snapshot.content).toBe("allowed bytes")
  })
})
