import { describe, expect, test } from "bun:test"

import {
  OPENMATH_RESEARCH_PHASE_A_BASE,
  OPENMATH_RESEARCH_PHASE_A_DIFF_FILTER,
  verifyOpenMathResearchPhaseAScope,
  type OpenMathResearchPhaseAScopeFacts,
} from "./verify-openmath-research-phase-a-scope"

describe("OpenMath research Phase A scope verification", () => {
  test("accepts Phase A paths, unchanged protected roots, and modular source", () => {
    expect(OPENMATH_RESEARCH_PHASE_A_DIFF_FILTER).toBe("ACMRD")
    expect(verifyOpenMathResearchPhaseAScope(facts())).toEqual([])
  })

  test("accepts legitimate cleanup filenames", () => {
    expect(verifyOpenMathResearchPhaseAScope(facts({
      changedPaths: [
        "src/openmath/research/application/campaign-operation-cleanup.test.ts",
        "src/openmath/research/storage/durable-lock-cleanup-failure.test.ts",
        "src/openmath/research/storage/lock-cleanup-error.ts",
      ],
    }))).toEqual([])
  })

  test("rejects protected workflow contracts and paths outside Phase A", () => {
    expect(verifyOpenMathResearchPhaseAScope(facts({
      changedPaths: [
        "src/openmath/workflow/state/schema.ts",
        "src/openmath/workflow/transitions/reduce-transition.ts",
        "src/openmath/workflow/profile-schema.ts",
        "src/openmath/workflow/adapters/review-verdict.ts",
        "src/shared/foreign.ts",
      ],
    }))).toEqual([
      "Path is outside the Phase A allowlist: src/shared/foreign.ts",
      "Protected workflow path must remain unchanged: src/openmath/workflow/adapters/review-verdict.ts",
      "Protected workflow path must remain unchanged: src/openmath/workflow/profile-schema.ts",
      "Protected workflow path must remain unchanged: src/openmath/workflow/state/schema.ts",
      "Protected workflow path must remain unchanged: src/openmath/workflow/transitions/reduce-transition.ts",
    ])
  })

  test("rejects Phase B-D, canonical-write, and continuation call sites", () => {
    const path = "src/openmath/research/future.ts"
    expect(verifyOpenMathResearchPhaseAScope(facts({
      changedPaths: [path],
      sourceFiles: new Map([[path, [
        "const obligation_graph = {}",
        "lean_command()",
        "effects.write_canonical()",
        "tasks.task_create()",
      ].join("\n")]]),
    }))).toEqual([
      `Canonical export/write signature is forbidden: write_canonical in ${path}:3`,
      `Continuation/task-dispatch signature is forbidden: task_create in ${path}:4`,
      `Forbidden Phase B-D signature: lean_command in ${path}:2`,
      `Forbidden Phase B-D signature: obligation_graph in ${path}:1`,
    ])
  })

  test("rejects computed forbidden calls without rejecting permitted computed properties", () => {
    const path = "src/openmath/research/computed.ts"
    expect(verifyOpenMathResearchPhaseAScope(facts({
      changedPaths: [path],
      sourceFiles: new Map([[path, [
        'effects["write_canonical"]()',
        'tasks["task_create"]()',
        'phaseB["lean_command"]()',
        'effects["write_draft"]()',
      ].join("\n")]]),
    }))).toEqual([
      `Canonical export/write signature is forbidden: write_canonical in ${path}:1`,
      `Continuation/task-dispatch signature is forbidden: task_create in ${path}:2`,
      `Forbidden Phase B-D signature: lean_command in ${path}:3`,
    ])
  })

  test("rejects extra public research surfaces and modular violations", () => {
    const path = "src/tools/openmath-research-canonical/index.ts"
    expect(verifyOpenMathResearchPhaseAScope(facts({
      changedPaths: [path],
      sourceFiles: new Map([[path, "export function canonical_promote() { return true as any }"]]),
    }))).toEqual([
      `Only the six Phase A research tools are allowed: ${path}`,
      `${path}: as any is forbidden`,
      `${path}: business logic in index.ts is forbidden`,
    ])
  })

  test("rejects similarly named top-level research tool neighbors", () => {
    const path = "src/tools/openmath-research-canonical.ts"
    expect(verifyOpenMathResearchPhaseAScope(facts({
      changedPaths: [path],
      sourceFiles: new Map([[path, "export const canonical = true"]]),
    }))).toEqual([`Path is outside the Phase A allowlist: ${path}`])
  })

  test("rejects later-phase filenames and aliased canonical imports", () => {
    const path = "src/openmath/research/obligation-graph.ts"
    expect(verifyOpenMathResearchPhaseAScope(facts({
      changedPaths: [path],
      sourceFiles: new Map([[path, 'import { write_canonical as persist } from "../../tools/openmath-export"\npersist()']]),
    }))).toEqual([
      `Canonical export/write signature is forbidden: write_canonical in ${path}:1`,
      `Forbidden Phase B-D surface: ${path}`,
    ])
  })

  test("rejects base and protected-root hash drift", () => {
    const changedHashes = new Map(facts().rootHashesAfter)
    changedHashes.set("failurecase.md", "changed")
    expect(verifyOpenMathResearchPhaseAScope(facts({
      base: "wrong",
      rootHashesAfter: changedHashes,
    }))).toEqual([
      `Immutable planning base must be ${OPENMATH_RESEARCH_PHASE_A_BASE}`,
      "Protected root file hash changed: failurecase.md",
    ])
  })
})

function facts(overrides: Partial<OpenMathResearchPhaseAScopeFacts> = {}): OpenMathResearchPhaseAScopeFacts {
  const hashes = new Map([
    ["failurecase.md", "a"],
    ["session-ses_22ce.md", "b"],
    ["session-summary-openmath-debugging-2026-04-28.md", "c"],
    ["testquery.txt", "d"],
  ])
  const path = "src/openmath/research/e2e/tool-factory-happy.test.ts"
  return {
    base: OPENMATH_RESEARCH_PHASE_A_BASE,
    changedPaths: [path],
    sourceFiles: new Map([[path, "export const phaseA = true"]]),
    rootHashesBefore: hashes,
    rootHashesAfter: hashes,
    ...overrides,
  }
}
