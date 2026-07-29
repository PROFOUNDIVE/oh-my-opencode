import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { renderReferenceBundle } from "./renderer"
import { createLegacyReferenceSnapshot, loadReferenceSnapshot } from "./snapshot"
import { REFERENCE_STAGES, type ReferenceSnapshot, type ReferenceSource } from "./types"

type MutationAttempt =
  | { readonly operation: "set"; readonly target: object; readonly property: PropertyKey; readonly value: unknown }
  | { readonly operation: "delete"; readonly target: object; readonly property: PropertyKey }

function renderAllStages(snapshot: ReferenceSnapshot): readonly string[] {
  return REFERENCE_STAGES.map((stage) => {
    const bundle = renderReferenceBundle(snapshot, stage)
    return `${bundle.sha256}\n${bundle.content}`
  })
}

function sourceMutations(source: ReferenceSource): readonly MutationAttempt[] {
  switch (source.kind) {
    case "file":
      return [
        { operation: "set", target: source, property: "canonicalPath", value: "changed-path" },
        { operation: "delete", target: source, property: "canonicalPath" },
      ]
    case "inline":
      return [
        { operation: "set", target: source, property: "path", value: "changed-path" },
        { operation: "delete", target: source, property: "path" },
      ]
    default:
      return assertNever(source)
  }
}

function assertRejectedMutations(snapshot: ReferenceSnapshot, attempts: readonly MutationAttempt[]): void {
  const before = renderAllStages(snapshot)
  for (const attempt of attempts) {
    switch (attempt.operation) {
      case "set":
        expect(Reflect.set(attempt.target, attempt.property, attempt.value)).toBe(false)
        break
      case "delete":
        expect(Reflect.deleteProperty(attempt.target, attempt.property)).toBe(false)
        break
      default:
        assertNever(attempt)
    }
    expect(renderAllStages(snapshot)).toEqual(before)
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected immutable snapshot variant: ${String(value)}`)
}

describe("OpenMath reference snapshot runtime immutability", () => {
  let projectDirectory: string

  beforeEach(() => {
    projectDirectory = mkdtempSync(join(tmpdir(), "openmath-reference-immutable-"))
  })

  afterEach(() => {
    rmSync(projectDirectory, { recursive: true, force: true })
  })

  test("freezes file snapshots, optional diagnostics, and file source metadata", () => {
    // #given
    const referencePath = join(projectDirectory, "reference.md")
    const manifestPath = join(projectDirectory, "references.json")
    writeFileSync(referencePath, "captured file content", "utf8")
    writeFileSync(manifestPath, JSON.stringify({
      version: 1,
      references: [
        { id: "file", path: "reference.md", role: "authoritative", stages: ["solve", "review", "revise"] },
        { id: "optional", path: "missing.md", role: "background", stages: ["solve"], required: false },
      ],
    }), "utf8")
    const snapshot = loadReferenceSnapshot({ referenceManifestPath: manifestPath, projectDirectory })
    const reference = snapshot.references.at(0)
    const diagnostic = snapshot.diagnostics.at(0)

    // #when / #then
    expect(reference).toBeDefined()
    expect(diagnostic).toBeDefined()
    if (!reference || !diagnostic || snapshot.manifest.kind !== "file") return
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.manifest)).toBe(true)
    expect(Object.isFrozen(snapshot.references)).toBe(true)
    expect(Object.isFrozen(reference)).toBe(true)
    expect(Object.isFrozen(reference.stages)).toBe(true)
    expect(Object.isFrozen(reference.source)).toBe(true)
    expect(Object.isFrozen(snapshot.diagnostics)).toBe(true)
    expect(Object.isFrozen(diagnostic)).toBe(true)
    assertRejectedMutations(snapshot, [
      { operation: "set", target: snapshot, property: "sha256", value: "changed" },
      { operation: "delete", target: snapshot, property: "manifest" },
      { operation: "set", target: snapshot.manifest, property: "canonicalPath", value: "changed" },
      { operation: "delete", target: snapshot.manifest, property: "canonicalPath" },
      { operation: "set", target: snapshot.references, property: "0", value: reference },
      { operation: "delete", target: snapshot.references, property: "0" },
      { operation: "set", target: reference, property: "content", value: "changed" },
      { operation: "set", target: reference, property: "sha256", value: "changed" },
      { operation: "set", target: reference, property: "role", value: "candidate" },
      { operation: "set", target: reference, property: "required", value: false },
      { operation: "delete", target: reference, property: "content" },
      { operation: "set", target: reference.stages, property: "0", value: "review" },
      { operation: "delete", target: reference.stages, property: "0" },
      ...sourceMutations(reference.source),
      { operation: "set", target: snapshot.diagnostics, property: "0", value: diagnostic },
      { operation: "delete", target: snapshot.diagnostics, property: "0" },
      { operation: "set", target: diagnostic, property: "id", value: "changed" },
      { operation: "delete", target: diagnostic, property: "path" },
    ])
  })

  test("freezes legacy inline snapshots without retaining caller containers", () => {
    // #given
    const supplementaryReferences = ["captured inline content"]
    const snapshot = createLegacyReferenceSnapshot(supplementaryReferences)
    const reference = snapshot.references.at(0)
    supplementaryReferences[0] = "changed caller value"

    // #when / #then
    expect(reference).toBeDefined()
    if (!reference) return
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.manifest)).toBe(true)
    expect(Object.isFrozen(snapshot.references)).toBe(true)
    expect(Object.isFrozen(reference)).toBe(true)
    expect(Object.isFrozen(reference.stages)).toBe(true)
    expect(Object.isFrozen(reference.source)).toBe(true)
    expect(Object.isFrozen(snapshot.diagnostics)).toBe(true)
    assertRejectedMutations(snapshot, [
      { operation: "set", target: snapshot.manifest, property: "kind", value: "file" },
      { operation: "delete", target: snapshot.manifest, property: "kind" },
      { operation: "set", target: reference, property: "content", value: "changed" },
      { operation: "set", target: reference, property: "sha256", value: "changed" },
      { operation: "set", target: reference, property: "role", value: "candidate" },
      { operation: "set", target: reference, property: "required", value: false },
      { operation: "set", target: reference.stages, property: "0", value: "review" },
      ...sourceMutations(reference.source),
      { operation: "set", target: snapshot.diagnostics, property: "0", value: { code: "optional_missing" } },
    ])
    expect(renderReferenceBundle(snapshot, "solve").content).toContain("captured inline content")
  })
})
