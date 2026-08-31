import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"
import { z } from "zod"

const HASH = z.string().regex(/^[0-9a-f]{64}$/)
const OID = z.string().regex(/^[0-9a-f]{40}$/)
const FILE_HASH = z.strictObject({ path: z.string().min(1), sha256: HASH })
const COMMAND = z.strictObject({
  name: z.string().min(1), command: z.string().min(1), exit_code: z.number().int(), expected_exit_code: z.number().int(), stdout_sha256: HASH, stderr_sha256: HASH,
})
const RECEIPT = z.strictObject({
  schema_version: z.literal(1), task: z.number().int().min(1).max(18), title: z.string().min(1), base_oid: OID, head_oid: OID,
  provenance: z.strictObject({ kind: z.literal("current-head-command"), output_prefix: z.string().min(1), captured_at: z.iso.datetime() }),
  source_files: z.array(FILE_HASH).min(1), test_files: z.array(FILE_HASH).min(1), commands: z.array(COMMAND).min(1),
  tdd: z.strictObject({ red_exit_code: z.literal(1), red_reason: z.string().min(1) }).optional(),
  semantic_tests: z.array(z.unknown()).optional(),
})

type TaskCommandSpec = Readonly<{ name: string; command: string }>
type TaskReceiptSpec = Readonly<{ task: number; title: string; sourcePaths: readonly string[]; testPaths: readonly string[]; commands: readonly TaskCommandSpec[] }>

const command = (text: string): string => `/usr/bin/bash -o pipefail -c "${text}"`
const focused = (text: string): readonly TaskCommandSpec[] => [{ name: "focused", command: command(text) }]

export const TASK_RECEIPT_SPECS: readonly TaskReceiptSpec[] = [
  { task: 1, title: "Freeze the Phase-A/public compatibility and execution baseline", sourcePaths: ["src/openmath/research/state/schema.ts"], testPaths: ["src/openmath/research/compatibility/old-profile-baseline.test.ts"], commands: focused("bun test src/openmath/research/compatibility/old-profile-baseline.test.ts") },
  { task: 2, title: "Add opt-in bounded certification profile configuration and frozen snapshot parsing", sourcePaths: ["src/openmath/research/profile-schema.ts"], testPaths: ["src/openmath/research/profile-certification.test.ts"], commands: focused("bun test src/openmath/research/profile-certification.test.ts src/openmath/research/candidates/frozen-candidate-sources.test.ts") },
  { task: 3, title: "Define strict certification identity, graph, assumption, evidence, and result contracts", sourcePaths: ["src/openmath/research/certification/state/schema.ts"], testPaths: ["src/openmath/research/certification/state/graph-contracts.test.ts"], commands: focused("bun test src/openmath/research/certification/state") },
  { task: 4, title: "Build source-bound graph extraction and independent coverage adapters", sourcePaths: ["src/openmath/research/certification/adapters/extraction-output-adapter.ts"], testPaths: ["src/openmath/research/certification/adapters/extraction-canonicalization.test.ts"], commands: focused("bun test src/openmath/research/certification/adapters") },
  { task: 5, title: "Implement pure certification transitions, eligibility, invalidation, and next actions", sourcePaths: ["src/openmath/research/certification/transitions/reduce-transition.ts"], testPaths: ["src/openmath/research/certification/transitions/operation-and-completion.test.ts"], commands: focused("bun test src/openmath/research/certification/transitions") },
  { task: 6, title: "Implement immutable certification sidecar storage under campaign locks", sourcePaths: ["src/openmath/research/certification/storage/compare-and-swap.ts"], testPaths: ["src/openmath/research/certification/storage/initialization-and-cas.test.ts"], commands: focused("bun test src/openmath/research/certification/storage") },
  { task: 7, title: "Add durable certification jobs and explicit-step crash reconciliation", sourcePaths: ["src/openmath/research/certification/scheduler/progress-certification-job-attempt.ts"], testPaths: ["src/openmath/research/certification/scheduler/job-restart-reconciliation.test.ts"], commands: focused("bun test src/openmath/research/certification/scheduler") },
  { task: 8, title: "Implement certification application services and sidecar publication protocol", sourcePaths: ["src/openmath/research/certification/application/step-research-certification.ts"], testPaths: ["src/openmath/research/certification/application/completed-publication.test.ts"], commands: focused("bun test src/openmath/research/certification/application") },
  { task: 9, title: "Execute extraction and coverage rounds with bounded retries", sourcePaths: ["src/openmath/research/certification/orchestration/run-extraction-coverage-round.ts"], testPaths: ["src/openmath/research/certification/orchestration/extraction-coverage-rounds.test.ts"], commands: focused("bun test src/openmath/research/certification/orchestration/extraction-coverage-*.test.ts") },
  { task: 10, title: "Implement bounded counterexample attack planning and adapters", sourcePaths: ["src/openmath/research/certification/scheduler/attack-planner.ts"], testPaths: ["src/openmath/research/certification/scheduler/attack-planner.test.ts"], commands: focused("bun test src/openmath/research/certification/scheduler/attack-planner.test.ts src/openmath/research/certification/adapters/attack-*.test.ts") },
  { task: 11, title: "Verify every proposed witness in an independent deny-all session", sourcePaths: ["src/openmath/research/certification/orchestration/run-witness-verification.ts"], testPaths: ["src/openmath/research/certification/orchestration/witness-verification-runner.test.ts"], commands: focused("bun test src/openmath/research/certification/orchestration/witness-*.test.ts src/openmath/research/certification/adapters/witness-*.test.ts") },
  { task: 12, title: "Complete certification with truthful evidence summaries and fail-closed uncertainty policy", sourcePaths: ["src/openmath/research/certification/state/build-certification-summary.ts"], testPaths: ["src/openmath/research/certification/state/final-summary-evidence-policy.test.ts"], commands: focused("bun test src/openmath/research/certification/state/final-summary-evidence-policy.test.ts src/openmath/research/certification/state/summary-and-finalization.test.ts src/openmath/research/certification/transitions/certification-finalization.test.ts") },
  { task: 13, title: "Insert certification into the existing promotion step without changing Phase A", sourcePaths: ["src/openmath/research/application/promotion-step-router.ts"], testPaths: ["src/openmath/research/application/promotion-certification-routing.test.ts"], commands: focused("bun test src/openmath/research/application/promotion-certification-routing.test.ts src/openmath/research/application/promotion-certification-gates.test.ts") },
  { task: 14, title: "Add deterministic PromotionDossierV2 and version-aware promotion gating", sourcePaths: ["src/openmath/research/dossier/build-promotion-dossier-v2.ts"], testPaths: ["src/openmath/research/dossier/promotion-dossier-v2.test.ts"], commands: focused("bun test src/openmath/research/dossier/promotion-dossier-v2*.test.ts src/openmath/research/state/promotion-version-invariants.test.ts src/openmath/research/transitions/promotion-v2-gating.test.ts") },
  { task: 15, title: "Extend status, amend, abort, and public envelopes for enabled runs only", sourcePaths: ["src/openmath/research/application/enabled-campaign-envelope.ts"], testPaths: ["src/tools/openmath-research-enabled-lifecycle.test.ts"], commands: focused("bun test src/openmath/research/application/enabled-*.test.ts src/tools/openmath-research-enabled-*.test.ts") },
  { task: 16, title: "Close runtime behavior with end-to-end, race, restart, and stale-artifact narratives", sourcePaths: ["src/openmath/research/e2e/certification-v2-store-fixture.ts"], testPaths: ["src/openmath/research/e2e/tool-factory-v2-lifecycle.test.ts"], commands: focused("bun test src/openmath/research/e2e") },
  { task: 17, title: "Publish Phase-B docs, fixtures, generated schema, and claim-hygiene guidance", sourcePaths: ["docs/openmath-research-campaigns.md"], testPaths: ["src/openmath/research/docs-examples.test.ts"], commands: focused("bun test src/openmath/research/docs-examples.test.ts") },
  { task: 18, title: "Add a fresh evidence-aware Phase-B scope verifier and run all global gates", sourcePaths: ["script/verify-openmath-research-phase-b-scope.ts", "script/verify-openmath-research-phase-b-receipts.ts"], testPaths: ["script/verify-openmath-research-phase-b-scope.test.ts", "script/verify-openmath-research-phase-b-receipts.test.ts"], commands: [
    { name: "verifier-tests", command: command("bun test script/verify-openmath-research-phase-b-scope.test.ts script/verify-openmath-research-phase-b-receipts.test.ts") },
    { name: "semantic-tests", command: command("bun test src/openmath/research/certification/adapters/attack-output-adapter.test.ts src/openmath/research/certification/transitions/witness-terminal-regressions.test.ts src/openmath/research/e2e/tool-factory-status-storage.test.ts src/openmath/research/e2e/tool-factory-stale-and-race.test.ts src/openmath/research/application/enabled-promotion-command.test.ts src/openmath/research/certification/state/final-summary-evidence-policy.test.ts") },
    { name: "phase-a-compatibility", command: command("bun test src/openmath/research/compatibility/old-profile-baseline.test.ts src/openmath/workflow src/tools/openmath-solve-only src/tools/openmath-workflow-*") },
    { name: "phase-b-global", command: command("bun test src/openmath/research src/tools/openmath-research-*") },
    { name: "full-test", command: command("bun test") }, { name: "typecheck", command: command("bun run typecheck") }, { name: "build", command: command("bun run build") },
    { name: "schema-first", command: command("bun run build:schema") }, { name: "schema-second", command: command("bun run build:schema") },
    { name: "modular", command: command("bun run script/check-modular-code.ts --base 944fd09915377b3582d40f44432ef0860a1213f3") },
    { name: "strict-compile", command: command("bunx tsc --noEmit --strict --skipLibCheck --module ESNext --moduleResolution bundler --target ESNext --types bun-types script/verify-openmath-research-phase-b-scope.ts script/verify-openmath-research-phase-b-scope.test.ts script/verify-openmath-research-phase-b-receipts.ts script/verify-openmath-research-phase-b-receipts.test.ts") },
    { name: "diff-check", command: command("GIT_MASTER=1 git diff --check") },
    { name: "scope-real", command: command("bun run script/verify-openmath-research-phase-b-scope.ts --base 944fd09915377b3582d40f44432ef0860a1213f3 --evidence .omo/evidence/openmath-research-campaign-phase-b") },
  ] },
] as const

const expectedReceiptNames = (): readonly string[] => TASK_RECEIPT_SPECS.map((spec) => taskReceiptName(spec.task))
const same = (left: readonly string[], right: readonly string[]): boolean => JSON.stringify(left) === JSON.stringify(right)
const sha256 = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex")

export function taskReceiptName(task: number): string {
  return `task-${String(task).padStart(2, "0")}-receipt.json`
}

export function verifyTaskReceiptChain(root: string, evidenceDirectory: string, requestedBase: string, head: string, required: Readonly<Record<string, string>>): readonly string[] {
  const failures: string[] = []
  const evidence = resolve(root, evidenceDirectory)
  const expectedNames = expectedReceiptNames()
  const observedNames = readdirSync(evidence).filter((name) => /^task-\d{2}-receipt.*\.json$/.test(name)).sort()
  if (!same(observedNames, [...expectedNames].sort()) || !same(Object.keys(required).sort(), [...expectedNames].sort())) failures.push("Task receipt inventory must contain exactly task-01-receipt.json through task-18-receipt.json")
  for (const spec of TASK_RECEIPT_SPECS) {
    const name = taskReceiptName(spec.task)
    const path = resolve(evidence, name)
    if (!existsSync(path)) { failures.push(`Task receipt is missing or duplicated: ${name}`); continue }
    const bytes = readFileSync(path)
    if (required[name] !== sha256(bytes)) { failures.push(`Task receipt byte hash mismatch: ${name}`); continue }
    const parsed = RECEIPT.safeParse(JSON.parse(bytes.toString("utf8")))
    if (!parsed.success) { failures.push(`Task receipt schema mismatch: ${name}`); continue }
    const receipt = parsed.data
    if (receipt.task !== spec.task || receipt.title !== spec.title || receipt.base_oid !== requestedBase || receipt.head_oid !== head || receipt.provenance.output_prefix !== `task-${String(spec.task).padStart(2, "0")}-`) failures.push(`Task receipt identity mismatch: ${name}`)
    verifyFiles(root, name, "source", spec.sourcePaths, receipt.source_files, failures)
    verifyFiles(root, name, "test", spec.testPaths, receipt.test_files, failures)
    if (!same(receipt.commands.map(({ name: commandName, command: commandText }) => `${commandName}\n${commandText}`), spec.commands.map(({ name: commandName, command: commandText }) => `${commandName}\n${commandText}`))) failures.push(`Task command receipt mismatch: ${name}`)
    for (const commandReceipt of receipt.commands) {
      if (commandReceipt.exit_code !== 0 || commandReceipt.expected_exit_code !== 0) failures.push(`Task command did not exit zero: ${name}: ${commandReceipt.name}`)
      for (const stream of ["stdout", "stderr"] as const) {
        const output = resolve(evidence, `task-${String(spec.task).padStart(2, "0")}-${commandReceipt.name}.${stream}`)
        if (!existsSync(output) || sha256(readFileSync(output)) !== commandReceipt[`${stream}_sha256`]) failures.push(`Task command ${stream} byte hash mismatch: ${name}: ${commandReceipt.name}`)
      }
    }
  }
  return [...new Set(failures)].sort()
}

function verifyFiles(root: string, receiptName: string, kind: "source" | "test", expectedPaths: readonly string[], files: readonly z.infer<typeof FILE_HASH>[], failures: string[]): void {
  if (!same(files.map((file) => file.path), expectedPaths)) { failures.push(`Task ${kind} path mismatch: ${receiptName}`); return }
  for (const file of files) if (!existsSync(resolve(root, file.path)) || sha256(readFileSync(resolve(root, file.path))) !== file.sha256) failures.push(`Task ${kind} byte hash mismatch: ${receiptName}: ${file.path}`)
}
