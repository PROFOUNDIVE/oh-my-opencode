import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { copyFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import {
  TASK_RECEIPT_SPECS,
  taskReceiptName,
  verifyTaskReceiptChain,
} from "./verify-openmath-research-phase-b-receipts"

const BASE = "944fd09915377b3582d40f44432ef0860a1213f3"
const HEAD = "1111111111111111111111111111111111111111"

test("accepts a complete current-HEAD receipt chain", () => {
  const fixture = createReceiptFixture()

  const failures = verifyTaskReceiptChain(fixture.root, "evidence", BASE, HEAD, fixture.required)

  expect(failures).toEqual([])
  rmSync(fixture.root, { recursive: true })
})

test("rejects a missing fixed receipt", () => {
  const fixture = createReceiptFixture({ omittedTask: 7 })

  const failures = verifyTaskReceiptChain(fixture.root, "evidence", BASE, HEAD, fixture.required)

  expect(failures).toContain("Task receipt is missing or duplicated: task-07-receipt.json")
  rmSync(fixture.root, { recursive: true })
})

test("rejects a substituted receipt path", () => {
  const fixture = createReceiptFixture()
  renameSync(join(fixture.root, "evidence/task-07-receipt.json"), join(fixture.root, "evidence/task-07-receipt-copy.json"))

  const failures = verifyTaskReceiptChain(fixture.root, "evidence", BASE, HEAD, fixture.required)

  expect(failures).toContain("Task receipt inventory must contain exactly task-01-receipt.json through task-18-receipt.json")
  rmSync(fixture.root, { recursive: true })
})

test("rejects a duplicate receipt name", () => {
  const fixture = createReceiptFixture()
  copyFileSync(join(fixture.root, "evidence/task-07-receipt.json"), join(fixture.root, "evidence/task-07-receipt-copy.json"))

  const failures = verifyTaskReceiptChain(fixture.root, "evidence", BASE, HEAD, fixture.required)

  expect(failures).toContain("Task receipt inventory must contain exactly task-01-receipt.json through task-18-receipt.json")
  rmSync(fixture.root, { recursive: true })
})

test("rejects receipt byte tampering", () => {
  const fixture = createReceiptFixture()
  writeFileSync(join(fixture.root, "evidence/task-04-receipt.json"), "{}")

  const failures = verifyTaskReceiptChain(fixture.root, "evidence", BASE, HEAD, fixture.required)

  expect(failures).toContain("Task receipt byte hash mismatch: task-04-receipt.json")
  rmSync(fixture.root, { recursive: true })
})

test("rejects a tampered manifest receipt hash", () => {
  const fixture = createReceiptFixture()
  const required = { ...fixture.required, "task-04-receipt.json": sha256("tampered hash") }

  const failures = verifyTaskReceiptChain(fixture.root, "evidence", BASE, HEAD, required)

  expect(failures).toContain("Task receipt byte hash mismatch: task-04-receipt.json")
  rmSync(fixture.root, { recursive: true })
})

test("rejects a stale receipt base", () => {
  const fixture = createReceiptFixture({ staleBaseTask: 11 })

  const failures = verifyTaskReceiptChain(fixture.root, "evidence", BASE, HEAD, fixture.required)

  expect(failures).toContain("Task receipt identity mismatch: task-11-receipt.json")
  rmSync(fixture.root, { recursive: true })
})

test("rejects source hash tampering independently of receipt-selected paths", () => {
  const fixture = createReceiptFixture()
  const sourcePath = TASK_RECEIPT_SPECS[2].sourcePaths[0]
  if (sourcePath === undefined) throw new TypeError("Task 3 source fixture is missing")
  writeFileSync(join(fixture.root, sourcePath), "tampered")

  const failures = verifyTaskReceiptChain(fixture.root, "evidence", BASE, HEAD, fixture.required)

  expect(failures).toContain(`Task source byte hash mismatch: task-03-receipt.json: ${sourcePath}`)
  rmSync(fixture.root, { recursive: true })
})

type FixtureOptions = Readonly<{ omittedTask?: number; staleBaseTask?: number }>

function createReceiptFixture(options: FixtureOptions = {}): Readonly<{ root: string; required: Readonly<Record<string, string>> }> {
  const root = mkdtempSync(join(tmpdir(), "phase-b-receipts-"))
  mkdirSync(join(root, "evidence"))
  const required: Record<string, string> = {}
  for (const spec of TASK_RECEIPT_SPECS) {
    const sourceFiles = spec.sourcePaths.map((path) => writeHashedFixture(root, path, `source:${path}`))
    const testFiles = spec.testPaths.map((path) => writeHashedFixture(root, path, `test:${path}`))
    const commands = spec.commands.map((command) => {
      const prefix = `task-${String(spec.task).padStart(2, "0")}-${command.name}`
      return {
        name: command.name,
        command: command.command,
        exit_code: 0,
        expected_exit_code: 0,
        stdout_sha256: writeEvidence(root, `${prefix}.stdout`, `${prefix}:stdout`),
        stderr_sha256: writeEvidence(root, `${prefix}.stderr`, `${prefix}:stderr`),
      }
    })
    const receipt = {
      schema_version: 1,
      task: spec.task,
      title: spec.title,
      base_oid: options.staleBaseTask === spec.task ? HEAD : BASE,
      head_oid: HEAD,
      provenance: { kind: "current-head-command", output_prefix: `task-${String(spec.task).padStart(2, "0")}-`, captured_at: "2026-08-31T00:00:00.000Z" },
      source_files: sourceFiles,
      test_files: testFiles,
      commands,
    }
    const name = taskReceiptName(spec.task)
    const bytes = `${JSON.stringify(receipt, null, 2)}\n`
    required[name] = sha256(bytes)
    if (options.omittedTask !== spec.task) writeFileSync(join(root, "evidence", name), bytes)
  }
  return { root, required }
}

function writeHashedFixture(root: string, path: string, bytes: string): Readonly<{ path: string; sha256: string }> {
  const absolute = join(root, path)
  mkdirSync(dirname(absolute), { recursive: true })
  writeFileSync(absolute, bytes)
  return { path, sha256: sha256(bytes) }
}

function writeEvidence(root: string, name: string, bytes: string): string {
  writeFileSync(join(root, "evidence", name), bytes)
  return sha256(bytes)
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}
