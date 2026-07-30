import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  REQUIRED_OPENMATH_WORKFLOW_SUCCESS_CRITERIA,
  verifyOpenMathWorkflowEvidence,
} from "./verify-openmath-workflow-evidence"

const BASE = "e3dba8329718052e672ebddea9b89caa3e207582"
const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("OpenMath workflow evidence verification", () => {
  test("accepts every task and success criterion with repository tests and evidence", () => {
    const fixture = createFixture()

    expect(() => verifyOpenMathWorkflowEvidence(fixture)).not.toThrow()
  })

  test("rejects a manifest that omits a required task receipt", () => {
    const fixture = createFixture()
    const manifest = JSON.parse(readFileSync(fixture.manifestPath, "utf8"))
    manifest.requirements = manifest.requirements.filter((requirement: { readonly id: string }) => requirement.id !== "task-15")
    writeFileSync(fixture.manifestPath, JSON.stringify(manifest), "utf8")

    expect(() => verifyOpenMathWorkflowEvidence(fixture)).toThrow("task-15")
  })

  test("rejects final-wave receipts embedded in the requirements manifest", () => {
    const fixture = createFixture()
    const manifest = JSON.parse(readFileSync(fixture.manifestPath, "utf8"))
    manifest.requirements[0].evidence_artifacts = ["F1.receipt.json"]
    writeFileSync(fixture.manifestPath, JSON.stringify(manifest), "utf8")

    expect(() => verifyOpenMathWorkflowEvidence(fixture)).toThrow("F1")
  })
})

function createFixture(): {
  readonly manifestPath: string
  readonly evidenceDirectory: string
  readonly projectDirectory: string
} {
  const directory = mkdtempSync(join(tmpdir(), "openmath-evidence-"))
  directories.push(directory)
  const projectDirectory = join(directory, "project")
  const evidenceDirectory = join(directory, "evidence")
  mkdirSync(projectDirectory)
  mkdirSync(evidenceDirectory)
  writeFileSync(join(projectDirectory, "contract.test.ts"), "export {}\n", "utf8")

  const requirements = [
    ...Array.from({ length: 15 }, (_, index) => requirement(`task-${index + 1}`)),
    ...REQUIRED_OPENMATH_WORKFLOW_SUCCESS_CRITERIA.map(({ id, criterion }) => requirement(id, criterion)),
  ]
  for (const entry of requirements) writeFileSync(join(evidenceDirectory, entry.evidence_artifacts[0]), "passed\n", "utf8")
  const manifestPath = join(directory, "manifest.json")
  writeFileSync(manifestPath, JSON.stringify({ immutable_base: BASE, requirements }), "utf8")
  return { manifestPath, evidenceDirectory, projectDirectory }
}

function requirement(id: string, criterion?: string): {
  readonly id: string
  readonly criterion?: string
  readonly test_files: readonly [string]
  readonly evidence_artifacts: readonly [string]
} {
  const entry: {
    readonly id: string
    readonly test_files: readonly [string]
    readonly evidence_artifacts: readonly [string]
  } = {
    id,
    test_files: ["contract.test.ts"],
    evidence_artifacts: [`${id}.log`],
  }
  return criterion === undefined ? entry : { ...entry, criterion }
}
