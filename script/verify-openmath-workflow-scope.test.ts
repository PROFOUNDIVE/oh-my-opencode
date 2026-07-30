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

  test("accepts only the exact F4 corrective test paths", () => {
    expect(verifyOpenMathWorkflowScope(facts({
      diffNameStatus: F4_CORRECTIVE_TEST_PATHS.map((path) => `M\t${path}`).join("\n"),
    }))).toEqual([])
  })

  test("rejects neighboring paths outside the exact F4 corrective set", () => {
    expect(verifyOpenMathWorkflowScope(facts({
      diffNameStatus: ["bin/foreign.test.ts", "src/cli/foreign.test.ts", "src/shared/foreign.test.ts", "src/hooks/foreign.test.ts"].map((path) => `A\t${path}`).join("\n"),
    }))).toEqual([
      "Path is outside the Task 1-15 allowlist: bin/foreign.test.ts",
      "Path is outside the Task 1-15 allowlist: src/cli/foreign.test.ts",
      "Path is outside the Task 1-15 allowlist: src/shared/foreign.test.ts",
      "Path is outside the Task 1-15 allowlist: src/hooks/foreign.test.ts",
    ])
  })

  test("accepts the generated OpenMath schema artifact", () => {
    expect(verifyOpenMathWorkflowScope(facts({
      diffNameStatus: "M\tassets/oh-my-openmath.schema.json",
    }))).toEqual([])
  })

  test("rejects neighboring generated assets", () => {
    expect(verifyOpenMathWorkflowScope(facts({
      diffNameStatus: "A\tassets/foreign.json",
    }))).toEqual([
      "Path is outside the Task 1-15 allowlist: assets/foreign.json",
    ])
  })
})

const F4_CORRECTIVE_TEST_PATHS = [
  "bin/platform.test.ts",
  "script/build-schema.test.ts",
  "src/cli/__snapshots__/model-fallback-native-providers.test.ts.snap",
  "src/cli/__snapshots__/model-fallback-provider-scenarios.test.ts.snap",
  "src/cli/__snapshots__/model-fallback.test.ts.snap",
  "src/cli/config-manager-model-fallback.test.ts",
  "src/cli/config-manager-provider-config.test.ts",
  "src/cli/config-manager.test.ts",
  "src/cli/install-config.test-fixture.ts",
  "src/cli/install.test.ts",
  "src/cli/model-fallback-agent-special-cases.test.ts",
  "src/cli/model-fallback-native-providers.test.ts",
  "src/cli/model-fallback-provider-scenarios.test.ts",
  "src/cli/model-fallback.test.ts",
  "src/cli/run/session-resolver.test.ts",
  "src/hooks/auto-update-checker/checker/pinned-version-updater.test.ts",
  "src/shared/model-availability-availability.test.ts",
  "src/shared/model-availability-connected-provider-filtering.test.ts",
  "src/shared/model-availability-connected-providers.test.ts",
  "src/shared/model-availability-fallback.test.ts",
  "src/shared/model-availability-fetch.test.ts",
  "src/shared/model-availability-fuzzy-match.test.ts",
  "src/shared/model-availability-provider-models-cache.test.ts",
  "src/shared/model-availability.test-fixture.ts",
  "src/shared/model-availability.test.ts",
  "src/shared/opencode-config-dir.test.ts",
] as const

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
