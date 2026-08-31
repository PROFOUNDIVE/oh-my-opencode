import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  verifyAcceptedInventoryHashes,
  verifyCommandOutputHashes,
  verifyCommandReceipts,
  verifyPhaseBSourceScope,
} from "./verify-openmath-research-phase-b-scope"

test("requires both the planning base and evidence directory", () => {
  // given
  const command = ["bun", "run", "script/verify-openmath-research-phase-b-scope.ts"]

  // when
  const result = Bun.spawnSync({ cmd: command, stdout: "pipe", stderr: "pipe" })

  // then
  expect(result.exitCode).not.toBe(0)
  expect(new TextDecoder().decode(result.stderr)).toContain(
    "Usage: bun run script/verify-openmath-research-phase-b-scope.ts --base <base> --evidence <directory>",
  )
})

test("rejects enumerated later-phase and evidence carry-forward surfaces", () => {
  // given
  const cases = [
    ["src/openmath/research/phase-c/runner.ts", "export const runner = true", "later-phase"],
    ["src/openmath/research/certification/state/ingress.ts", "export const evidence_carry_forward = true", "evidence"],
  ] as const

  // when
  const failures = cases.flatMap(([path, source]) => verifyPhaseBSourceScope(
    [path],
    new Map([[path, source]]),
    exactRegistry(),
  ))

  // then
  expect(failures.some((failure) => failure.includes("phase-c"))).toBe(true)
  expect(failures.some((failure) => failure.includes("evidence_carry_forward"))).toBe(true)
})

test.each([
  ["Layer-0 field", "src/openmath/workflow/state/schema.ts", "export const certification = true", "Protected Layer-0"],
  ["shell backend", "src/openmath/research/certification/shell.ts", 'import { spawn } from "node:child_process"\nspawn("sh")', "executable/backend"],
  ["executable backend", "src/openmath/research/certification/backend.ts", "export const executable_backend = {}", "later-phase/backend"],
  ["machine proof", "src/openmath/research/certification/claim.ts", "export const result = { mathematical_correctness_certified: true }", "machine/canonical"],
  ["canonical write", "src/openmath/research/certification/write.ts", "authority.write_canonical()", "canonical call"],
  ["continuation", "src/openmath/research/certification/follow-up.ts", "tasks.task_create()", "continuation"],
  ["broad evidence ingress", "src/openmath/research/certification/state/ingress.ts", 'export const MachineEvidenceSchema = z.literal("LEAN_KERNEL")', "evidence-ingress"],
  ["dynamic shell import", "src/openmath/research/certification/dynamic.ts", 'import("node:child_process")', "executable/backend"],
  ["computed Bun execution", "src/openmath/research/certification/computed.ts", 'Bun["spawn"](["sh"])', "executable/continuation"],
  ["computed machine claim", "src/openmath/research/certification/claim.ts", 'export const result = { ["canonical"]: true }', "machine/canonical"],
  ["aliased canonical import", "src/openmath/research/certification/alias.ts", 'import { write_canonical as persist } from "./writer"\npersist()', "canonical"],
  ["extracted canonical call", "src/openmath/research/certification/extracted.ts", 'const persist = authority["write_canonical"]\npersist()', "canonical"],
] as const)("rejects %s syntax", (_label, path, source, diagnostic) => {
  // when
  const failures = verifyPhaseBSourceScope([path], new Map([[path, source]]), exactRegistry())

  // then
  expect(failures.some((failure) => failure.includes(diagnostic))).toBe(true)
})

test("rejects a seventh public research tool", () => {
  // when
  const failures = verifyPhaseBSourceScope([], new Map(), exactRegistry().replace(
    "[OpenMathResearchAbortToolKey]: abort,",
    "[OpenMathResearchAbortToolKey]: abort, [OpenMathResearchCanonicalToolKey]: canonical,",
  ))

  // then
  expect(failures).toContainEqual(expect.stringContaining("exactly six tools"))
})

test("rejects a seventh public research tool hidden in a spread", () => {
  // given
  const registry = exactRegistry().replace("return {", "const extra = { [OpenMathResearchCanonicalToolKey]: canonical }\nreturn { ...extra,")

  // when
  const failures = verifyPhaseBSourceScope([], new Map(), registry)

  // then
  expect(failures).toContainEqual(expect.stringContaining("exactly six tools"))
})

test("enforces the logic line limit on the verifier itself", () => {
  // given
  const path = "script/verify-openmath-research-phase-b-scope.ts"
  const source = Array.from({ length: 201 }, (_, index) => `const value${index} = ${index}`).join("\n")

  // when
  const failures = verifyPhaseBSourceScope([path], new Map([[path, source]]), exactRegistry())

  // then
  expect(failures).toContain(`${path}: 201 logic LOC exceeds 200`)
})

test("accepts the fixed receipt verifier modules", () => {
  const paths = [
    "script/verify-openmath-research-phase-b-receipts.ts",
    "script/verify-openmath-research-phase-b-receipts.test.ts",
  ]

  const failures = verifyPhaseBSourceScope(paths, new Map(paths.map((path) => [path, "export const receipt = true"])), exactRegistry())

  expect(failures).toEqual([])
})

test("accepts only the exact final-wave prompt resolver remediation path", () => {
  const exact = "src/agents/builtin-agents/replacement-prompt-resolver.ts"
  const sibling = "src/agents/builtin-agents/unrelated.ts"

  const exactFailures = verifyPhaseBSourceScope([exact], new Map([[exact, "export const remediation = true"]]), exactRegistry())
  const siblingFailures = verifyPhaseBSourceScope([sibling], new Map([[sibling, "export const unrelated = true"]]), exactRegistry())

  expect(exactFailures).toEqual([])
  expect(siblingFailures).toContain(`Path is outside the Phase-B allowlist: ${sibling}`)
})

test.each(["other-untracked", "evidence"])("rejects byte drift in stable %s inventory", (category) => {
  // given
  const root = mkdtempSync(join(tmpdir(), "phase-b-inventory-"))
  writeFileSync(join(root, "accepted.txt"), "changed")

  // when
  const failures = verifyAcceptedInventoryHashes(root, [{
    path: "accepted.txt",
    category,
    sha256: sha256("original"),
  }])

  // then
  expect(failures).toEqual(["Accepted untracked byte hash mismatch: accepted.txt"])
  rmSync(root, { recursive: true })
})

test("rejects command hashes that do not match fixed output files", () => {
  // given
  const root = mkdtempSync(join(tmpdir(), "phase-b-commands-"))
  writeFileSync(join(root, "task-18-build.stdout"), "actual stdout")
  writeFileSync(join(root, "task-18-build.stderr"), "actual stderr")

  // when
  const failures = verifyCommandOutputHashes(root, ".", [{
    name: "build",
    stdout_sha256: sha256("claimed stdout"),
    stderr_sha256: sha256("claimed stderr"),
  }])

  // then
  expect(failures).toEqual([
    "Command stderr byte hash mismatch: build",
    "Command stdout byte hash mismatch: build",
  ])
  rmSync(root, { recursive: true })
})

test("rejects nonzero gates and altered required command text", () => {
  // given
  const commands = [{
    name: "build",
    command: '/usr/bin/bash -o pipefail -c "true"',
    exit_code: 1,
    expected_exit_code: 1,
    stdout_sha256: sha256(""),
    stderr_sha256: sha256(""),
  }]

  // when
  const failures = verifyCommandReceipts(commands)

  // then
  expect(failures).toContain("Required command text mismatch: build")
  expect(failures).toContain("Required command did not exit zero: build")
})

function exactRegistry(): string {
  return `
    export function createOpenMathResearchTools() {
      return {
        [OpenMathResearchStartToolKey]: start,
        [OpenMathResearchStatusToolKey]: status,
        [OpenMathResearchStepToolKey]: step,
        [OpenMathResearchAmendToolKey]: amend,
        [OpenMathResearchPromoteToolKey]: promote,
        [OpenMathResearchAbortToolKey]: abort,
      }
    }
  `
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}
