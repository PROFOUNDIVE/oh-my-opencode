import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { renderReferenceBundle } from "./renderer"
import { createLegacyReferenceSnapshot, loadReferenceSnapshot } from "./snapshot"

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex")
}

describe("OpenMath reference snapshots", () => {
  let projectDirectory: string
  let referencesDirectory: string

  beforeEach(() => {
    projectDirectory = mkdtempSync(join(tmpdir(), "openmath-reference-project-"))
    referencesDirectory = join(projectDirectory, "references")
    mkdirSync(referencesDirectory)
  })

  afterEach(() => {
    rmSync(projectDirectory, { recursive: true, force: true })
  })

  test("converts legacy supplementary references into immutable all-stage inline snapshots", () => {
    // #given
    const snapshot = createLegacyReferenceSnapshot(["first supplementary", "second supplementary"])

    // #when
    const solve = renderReferenceBundle(snapshot, "solve")
    const review = renderReferenceBundle(snapshot, "review")
    const revise = renderReferenceBundle(snapshot, "revise")

    // #then
    expect(snapshot.references.map((reference) => reference.id)).toEqual([
      "supplementary-1",
      "supplementary-2",
    ])
    expect(snapshot.references.map((reference) => reference.source.kind)).toEqual(["inline", "inline"])
    expect(snapshot.references.every((reference) => reference.role === "background")).toBe(true)
    expect(solve.sha256).toBe(review.sha256)
    expect(review.sha256).toBe(revise.sha256)
    expect(solve.content).toContain("first supplementary")
  })

  test("hashes ordered references with unambiguous framing", () => {
    // #given
    const splitSnapshot = createLegacyReferenceSnapshot(["a", "bc"])
    const joinedSnapshot = createLegacyReferenceSnapshot(["ab", "c"])

    // #when
    const splitBundle = renderReferenceBundle(splitSnapshot, "solve")
    const joinedBundle = renderReferenceBundle(joinedSnapshot, "solve")

    // #then
    expect(splitBundle.sha256).not.toBe(joinedBundle.sha256)
  })

  test("parses YAML and JSONC manifests into equal ordered solve bundles", () => {
    // #given
    const authoritativePath = join(referencesDirectory, "authoritative.md")
    const candidatePath = join(referencesDirectory, "candidate.md")
    const yamlPath = join(projectDirectory, "references.yaml")
    const jsoncPath = join(projectDirectory, "references.jsonc")
    writeFileSync(authoritativePath, "authoritative proof", "utf8")
    writeFileSync(candidatePath, "candidate note", "utf8")
    writeFileSync(yamlPath, [
      "version: 1",
      "references:",
      "  - id: theorem",
      "    path: references/authoritative.md",
      "    role: authoritative",
      "    stages: [solve, review]",
      "  - id: observation",
      "    path: references/candidate.md",
      "    role: candidate",
      "    stages: [review, revise]",
      "  - id: absent",
      "    path: references/absent.md",
      "    role: background",
      "    stages: [solve]",
      "    required: false",
      "",
    ].join("\n"), "utf8")
    writeFileSync(jsoncPath, [
      "{",
      "  // equivalent manifest",
      "  \"version\": 1,",
      "  \"references\": [",
      "    { \"id\": \"theorem\", \"path\": \"references/authoritative.md\", \"role\": \"authoritative\", \"stages\": [\"solve\", \"review\"] },",
      "    { \"id\": \"observation\", \"path\": \"references/candidate.md\", \"role\": \"candidate\", \"stages\": [\"review\", \"revise\"] },",
      "    { \"id\": \"absent\", \"path\": \"references/absent.md\", \"role\": \"background\", \"stages\": [\"solve\"], \"required\": false }",
      "  ]",
      "}",
      "",
    ].join("\n"), "utf8")

    // #when
    const yamlSnapshot = loadReferenceSnapshot({
      referenceManifestPath: yamlPath,
      projectDirectory,
    })
    const jsoncSnapshot = loadReferenceSnapshot({
      referenceManifestPath: `file://${jsoncPath}`,
      projectDirectory,
    })
    const yamlSolve = renderReferenceBundle(yamlSnapshot, "solve")
    const jsoncSolve = renderReferenceBundle(jsoncSnapshot, "solve")

    // #then
    expect(yamlSnapshot.references.map((reference) => reference.id)).toEqual(["theorem", "observation"])
    expect(yamlSnapshot.references[0]?.required).toBe(true)
    expect(yamlSnapshot.diagnostics).toEqual([{
      code: "optional_missing",
      id: "absent",
      path: "references/absent.md",
    }])
    expect(yamlSolve.sha256).toBe(jsoncSolve.sha256)
    expect(yamlSolve.content).toBe(jsoncSolve.content)
  })

  test("renders scoped metadata and preserves the captured source bytes after source edits", () => {
    // #given
    const referencePath = join(referencesDirectory, "source.md")
    const manifestPath = join(projectDirectory, "references.json")
    const original = "captured source"
    const originalHash = sha256(original)
    writeFileSync(referencePath, original, "utf8")
    writeFileSync(manifestPath, JSON.stringify({
      version: 1,
      references: [{
        id: "source",
        path: "references/source.md",
        role: "accepted_prior",
        stages: ["review"],
      }],
    }), "utf8")
    const snapshot = loadReferenceSnapshot({ referenceManifestPath: manifestPath, projectDirectory })
    const beforeEdit = renderReferenceBundle(snapshot, "review")

    // #when
    writeFileSync(referencePath, "changed after snapshot", "utf8")
    const afterEdit = renderReferenceBundle(snapshot, "review")

    // #then
    expect(afterEdit).toEqual(beforeEdit)
    expect(afterEdit.content).toBe([
      "# OpenMath Reference Bundle",
      "Stage: review",
      `SHA-256: ${beforeEdit.sha256}`,
      "",
      "## Reference: source",
      "Role: accepted_prior",
      `Path: ${referencePath}`,
      `SHA-256: ${originalHash}`,
      "",
      original,
      "",
    ].join("\n"))
  })
})
