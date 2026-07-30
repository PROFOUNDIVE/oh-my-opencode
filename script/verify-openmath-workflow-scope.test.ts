import { describe, expect, test } from "bun:test"

import {
  OPENMATH_WORKFLOW_BASE,
  verifyOpenMathWorkflowScope,
  type OpenMathWorkflowScopeFacts,
} from "./verify-openmath-workflow-scope"

describe("OpenMath workflow scope verification", () => {
  test("accepts the Task 1 boundary, approved paths, volatile planner paths, and unchanged user files", () => {
    expect(verifyOpenMathWorkflowScope(facts())).toEqual([])
  })

  test("rejects dependency and patch-engine edits even inside otherwise allowed roots", () => {
    expect(verifyOpenMathWorkflowScope(facts({ diffNameStatus: "M\tpackage.json\nM\tsrc/openmath/artifacts-patch/apply.ts" }))).toEqual([
      "Dependency file must remain unchanged: package.json",
      "Patch engine must remain unchanged: src/openmath/artifacts-patch/apply.ts",
    ])
  })

  test("rejects changed user files and unapproved paths", () => {
    expect(verifyOpenMathWorkflowScope(facts({
      diffNameStatus: "A\tscripts/foreign.ts",
      hashForPath: () => "changed",
    }))).toEqual([
      "Path is outside the Task 1-15 allowlist: scripts/foreign.ts",
      "User-owned untracked file changed: failurecase.md",
    ])
  })
})

function facts(overrides: Partial<OpenMathWorkflowScopeFacts> = {}): OpenMathWorkflowScopeFacts {
  const stableHash = "56d78008da99dbaf5f115e9bf6314749c2d1617207990f505f413f2f6e907568"
  return {
    base: OPENMATH_WORKFLOW_BASE,
    firstCommitParent: OPENMATH_WORKFLOW_BASE,
    firstCommitPaths: ["src/openmath/storage-write-fallback.test.ts", "src/openmath/storage.ts"],
    diffNameStatus: "M\tREADME.md\nA\tdocs/examples/openmath-workflow/profile.jsonc",
    untrackedPaths: ".omo/evidence/openmath-review-loop/task-15-red.log\nfailurecase.md",
    initialDirty: " M src/openmath/storage.ts\n?? .omo/",
    initialUntracked: ".omo/boulder.json\nfailurecase.md\nsession-ses_22ce.md\nsession-summary-openmath-debugging-2026-04-28.md\ntestquery.txt",
    initialUntrackedHashes: `${stableHash}  failurecase.md\n${stableHash}  session-ses_22ce.md\n${stableHash}  session-summary-openmath-debugging-2026-04-28.md\n${stableHash}  testquery.txt`,
    hashForPath: () => stableHash,
    ...overrides,
  }
}
