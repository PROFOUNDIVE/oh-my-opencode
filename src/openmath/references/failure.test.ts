import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { ReferenceManifestError } from "./types"
import { loadReferenceSnapshot } from "./snapshot"

function writeManifest(projectDirectory: string, name: string, content: string): string {
  const manifestPath = join(projectDirectory, name)
  writeFileSync(manifestPath, content, "utf8")
  return manifestPath
}

function expectPreDispatchError(manifestPath: string, projectDirectory: string, code: string): void {
  let stageRunnerCalls = 0
  let diagnostic: ReferenceManifestError | undefined

  try {
    const snapshot = loadReferenceSnapshot({ referenceManifestPath: manifestPath, projectDirectory })
    stageRunnerCalls += snapshot.references.length
  } catch (error) {
    if (error instanceof ReferenceManifestError) diagnostic = error
    else throw error
  }

  expect(stageRunnerCalls).toBe(0)
  expect(diagnostic?.code).toBe(code)
}

describe("OpenMath reference manifest failures", () => {
  let projectDirectory: string
  let outsideDirectory: string
  let collisionDirectory: string | undefined

  beforeEach(() => {
    projectDirectory = mkdtempSync(join(tmpdir(), "openmath-reference-project-"))
    outsideDirectory = mkdtempSync(join(tmpdir(), "openmath-reference-outside-"))
  })

  afterEach(() => {
    rmSync(projectDirectory, { recursive: true, force: true })
    rmSync(outsideDirectory, { recursive: true, force: true })
    if (collisionDirectory) rmSync(collisionDirectory, { recursive: true, force: true })
  })

  test("rejects traversal outside the canonical allowed root before dispatch", () => {
    // #given
    writeFileSync(join(outsideDirectory, "outside.md"), "outside", "utf8")
    const manifestPath = writeManifest(projectDirectory, "references.yaml", [
      "version: 1",
      "references:",
      "  - id: outside",
      `    path: ../${basename(outsideDirectory)}/outside.md`,
      "    role: background",
      "    stages: [solve]",
      "",
    ].join("\n"))

    // #when / #then
    expectPreDispatchError(manifestPath, projectDirectory, "outside_allowed_roots")
  })

  test("rejects an outside-root symlink before dispatch", () => {
    // #given
    const outsidePath = join(outsideDirectory, "outside.md")
    writeFileSync(outsidePath, "outside", "utf8")
    symlinkSync(outsidePath, join(projectDirectory, "escape.md"))
    const manifestPath = writeManifest(projectDirectory, "references.json", JSON.stringify({
      version: 1,
      references: [{ id: "escape", path: "escape.md", role: "background", stages: ["review"] }],
    }))

    // #when / #then
    expectPreDispatchError(manifestPath, projectDirectory, "outside_allowed_roots")
  })

  test("rejects a prefix-collision target outside the canonical root before dispatch", () => {
    // #given
    collisionDirectory = `${projectDirectory}-copy`
    mkdirSync(collisionDirectory)
    writeFileSync(join(collisionDirectory, "outside.md"), "outside", "utf8")
    const manifestPath = writeManifest(projectDirectory, "references.jsonc", JSON.stringify({
      version: 1,
      references: [{
        id: "collision",
        path: `../${basename(collisionDirectory)}/outside.md`,
        role: "background",
        stages: ["solve"],
      }],
    }))

    // #when / #then
    expectPreDispatchError(manifestPath, projectDirectory, "outside_allowed_roots")
  })

  test("rejects duplicate IDs before reading targets", () => {
    // #given
    const manifestPath = writeManifest(projectDirectory, "references.yaml", [
      "version: 1",
      "references:",
      "  - id: duplicate",
      "    path: first.md",
      "    role: background",
      "    stages: [solve]",
      "  - id: duplicate",
      "    path: second.md",
      "    role: candidate",
      "    stages: [review]",
      "",
    ].join("\n"))

    // #when / #then
    expectPreDispatchError(manifestPath, projectDirectory, "duplicate_id")
  })

  test("rejects unsupported manifest extensions before parsing", () => {
    // #given
    const manifestPath = writeManifest(projectDirectory, "references.txt", "{}")

    // #when / #then
    expectPreDispatchError(manifestPath, projectDirectory, "unsupported_extension")
  })

  test("rejects invalid UTF-8 target bytes before dispatch", () => {
    // #given
    writeFileSync(join(projectDirectory, "invalid.md"), Buffer.from([0xc3, 0x28]))
    const manifestPath = writeManifest(projectDirectory, "references.json", JSON.stringify({
      version: 1,
      references: [{ id: "invalid", path: "invalid.md", role: "background", stages: ["solve"] }],
    }))

    // #when / #then
    expectPreDispatchError(manifestPath, projectDirectory, "invalid_utf8")
  })

  test("rejects missing required references and invalid v1 schemas before dispatch", () => {
    // #given
    const missingManifestPath = writeManifest(projectDirectory, "missing.json", JSON.stringify({
      version: 1,
      references: [{ id: "missing", path: "missing.md", role: "background", stages: ["solve"] }],
    }))
    const invalidSchemaPath = writeManifest(projectDirectory, "invalid.yaml", "version: 2\nreferences: []\n")

    // #when / #then
    expectPreDispatchError(missingManifestPath, projectDirectory, "missing")
    expectPreDispatchError(invalidSchemaPath, projectDirectory, "invalid_schema")
  })

  test("rejects malformed parser input before schema validation or dispatch", () => {
    // #given
    const manifestPath = writeManifest(projectDirectory, "malformed.jsonc", "{ \"version\": 1,")

    // #when / #then
    expectPreDispatchError(manifestPath, projectDirectory, "invalid_syntax")
  })
})
