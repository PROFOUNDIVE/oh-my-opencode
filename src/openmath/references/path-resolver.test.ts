import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveAllowedRoots, resolveManifestPath } from "./path-resolver"
import { ReferenceManifestError } from "./types"

describe("OpenMath reference path resolution", () => {
  let projectDirectory: string
  let homeDirectory: string
  let allowedDirectory: string

  beforeEach(() => {
    projectDirectory = mkdtempSync(join(tmpdir(), "openmath-reference-project-"))
    homeDirectory = mkdtempSync(join(tmpdir(), "openmath-reference-home-"))
    allowedDirectory = join(projectDirectory, "allowed")
    mkdirSync(allowedDirectory)
  })

  afterEach(() => {
    rmSync(projectDirectory, { recursive: true, force: true })
    rmSync(homeDirectory, { recursive: true, force: true })
  })

  test("resolves project-relative, absolute, file URI, and home manifest paths inside canonical roots", () => {
    // #given
    const relativeManifest = join(allowedDirectory, "relative.yaml")
    const spacedManifest = join(allowedDirectory, "with space.json")
    const homeManifest = join(homeDirectory, "home.yml")
    writeFileSync(relativeManifest, "version: 1\nreferences: []\n", "utf8")
    writeFileSync(spacedManifest, "{ \"version\": 1, \"references\": [] }", "utf8")
    writeFileSync(homeManifest, "version: 1\nreferences: []\n", "utf8")
    const projectRoots = resolveAllowedRoots({
      projectDirectory,
      configuredRoots: ["allowed"],
      homeDirectory,
    })
    const homeRoots = resolveAllowedRoots({
      projectDirectory,
      configuredRoots: ["~/"],
      homeDirectory,
    })

    // #when
    const relative = resolveManifestPath({
      referenceManifestPath: "allowed/relative.yaml",
      projectDirectory,
      allowedRoots: projectRoots,
      homeDirectory,
    })
    const absolute = resolveManifestPath({
      referenceManifestPath: spacedManifest,
      projectDirectory,
      allowedRoots: projectRoots,
      homeDirectory,
    })
    const fileUri = resolveManifestPath({
      referenceManifestPath: `file://${encodeURIComponent(spacedManifest)}`,
      projectDirectory,
      allowedRoots: projectRoots,
      homeDirectory,
    })
    const home = resolveManifestPath({
      referenceManifestPath: "~/home.yml",
      projectDirectory,
      allowedRoots: homeRoots,
      homeDirectory,
    })

    // #then
    expect(relative.canonicalPath).toBe(relativeManifest)
    expect(absolute.canonicalPath).toBe(spacedManifest)
    expect(fileUri.canonicalPath).toBe(spacedManifest)
    expect(home.canonicalPath).toBe(homeManifest)
  })

  test("rejects missing roots and manifest paths outside canonical roots", () => {
    // #given
    const outsideManifest = join(projectDirectory, "outside.yaml")
    const fileRoot = join(projectDirectory, "not-a-directory")
    writeFileSync(outsideManifest, "version: 1\nreferences: []\n", "utf8")
    writeFileSync(fileRoot, "not a directory", "utf8")

    // #when / #then
    expect(() => resolveAllowedRoots({
      projectDirectory,
      configuredRoots: ["missing"],
      homeDirectory,
    })).toThrow(ReferenceManifestError)
    expect(() => resolveAllowedRoots({
      projectDirectory,
      configuredRoots: ["not-a-directory"],
      homeDirectory,
    })).toThrow(ReferenceManifestError)
    const roots = resolveAllowedRoots({
      projectDirectory,
      configuredRoots: ["allowed"],
      homeDirectory,
    })
    expect(() => resolveManifestPath({
      referenceManifestPath: outsideManifest,
      projectDirectory,
      allowedRoots: roots,
      homeDirectory,
    })).toThrow(ReferenceManifestError)
  })
})
