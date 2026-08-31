import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import ts from "typescript"
import { z } from "zod"

import { scanTypeScript } from "./modular-code-scanner"
import { verifyTaskReceiptChain } from "./verify-openmath-research-phase-b-receipts"

export const OPENMATH_RESEARCH_PHASE_B_BASE = "944fd09915377b3582d40f44432ef0860a1213f3"
const HASH = z.string().regex(/^[0-9a-f]{64}$/)
const OID = z.string().regex(/^[0-9a-f]{40}$/)
const FILE_HASH = z.strictObject({ path: z.string().min(1), sha256: HASH })
const COMMAND_NAMES = ["verifier-tests", "semantic-tests", "phase-a-compatibility", "phase-b-global", "full-test", "typecheck", "build", "schema-first", "schema-second", "modular", "strict-compile", "diff-check", "scope-real"] as const
const COMMAND_TEXT: Readonly<Record<(typeof COMMAND_NAMES)[number], string>> = {
  "verifier-tests": "bun test script/verify-openmath-research-phase-b-scope.test.ts script/verify-openmath-research-phase-b-receipts.test.ts",
  "semantic-tests": "bun test src/openmath/research/certification/adapters/attack-output-adapter.test.ts src/openmath/research/certification/transitions/witness-terminal-regressions.test.ts src/openmath/research/e2e/tool-factory-status-storage.test.ts src/openmath/research/e2e/tool-factory-stale-and-race.test.ts src/openmath/research/application/enabled-promotion-command.test.ts src/openmath/research/certification/state/final-summary-evidence-policy.test.ts",
  "phase-a-compatibility": "bun test src/openmath/research/compatibility/old-profile-baseline.test.ts src/openmath/workflow src/tools/openmath-solve-only src/tools/openmath-workflow-*",
  "phase-b-global": "bun test src/openmath/research src/tools/openmath-research-*", "full-test": "bun test", "typecheck": "bun run typecheck", "build": "bun run build",
  "schema-first": "bun run build:schema", "schema-second": "bun run build:schema",
  "modular": "bun run script/check-modular-code.ts --base 944fd09915377b3582d40f44432ef0860a1213f3",
  "strict-compile": "bunx tsc --noEmit --strict --skipLibCheck --module ESNext --moduleResolution bundler --target ESNext --types bun-types script/verify-openmath-research-phase-b-scope.ts script/verify-openmath-research-phase-b-scope.test.ts script/verify-openmath-research-phase-b-receipts.ts script/verify-openmath-research-phase-b-receipts.test.ts",
  "diff-check": "GIT_MASTER=1 git diff --check",
  "scope-real": "bun run script/verify-openmath-research-phase-b-scope.ts --base 944fd09915377b3582d40f44432ef0860a1213f3 --evidence .omo/evidence/openmath-research-campaign-phase-b",
}
const COMMAND = z.strictObject({ name: z.enum(COMMAND_NAMES), command: z.string().min(1), exit_code: z.number().int(), expected_exit_code: z.number().int(), stdout_sha256: HASH, stderr_sha256: HASH })
const SEMANTIC_TESTS = [
  { claim: "negative-search", path: "src/openmath/research/certification/adapters/attack-output-adapter.test.ts", name: "derives only LLM counterargument evidence and never trusts reported case counts as bounds" },
  { claim: "witness-eligibility", path: "src/openmath/research/certification/transitions/witness-terminal-regressions.test.ts", name: "rejects attempts to suppress a confirmed witness with a later negative attack" },
  { claim: "status-purity", path: "src/openmath/research/e2e/tool-factory-status-storage.test.ts", name: "reports both-absent NOT_STARTED without changing campaign storage" },
  { claim: "stale-artifact", path: "src/openmath/research/e2e/tool-factory-stale-and-race.test.ts", name: "blocks exact selected-artifact content drift before allocating certification" },
  { claim: "reject-with-sidecar-loss", path: "src/openmath/research/application/enabled-promotion-command.test.ts", name: "rejects from persisted V2 bytes without rereading a lost sidecar" },
  { claim: "evidence-ingress", path: "src/openmath/research/certification/state/final-summary-evidence-policy.test.ts", name: "rejects reserved CAS, SMT, and Lean evidence at the persisted state boundary" },
] as const
const SEMANTIC = z.strictObject({ claim: z.enum(SEMANTIC_TESTS.map((test) => test.claim)), path: z.string(), test_name: z.string(), sha256: HASH })
const FIXTURE_HASHES = z.strictObject({
  "src/tools/openmath-workflow-contracts.test.ts": HASH, "src/tools/openmath-workflow-happy.test.ts": HASH,
  "src/openmath/workflow/e2e.test.ts": HASH, "src/openmath/workflow/e2e-fixture.ts": HASH,
  "src/openmath/workflow/transitions/legality-matrix.test.ts": HASH, "src/openmath/workflow/transitions/checkpoint-matrix.test.ts": HASH,
  "src/tools/__snapshots__/openmath-workflow-contracts.test.ts.snap": HASH,
})
const V1_HASHES = z.strictObject({ "src/openmath/research/compatibility/old-profile-baseline.fixture.ts": HASH, "src/openmath/research/compatibility/old-profile-baseline.test.ts": HASH })
const ROOT_HASHES = z.strictObject({ "failurecase.md": HASH, "session-ses_22ce.md": HASH, "session-summary-openmath-debugging-2026-04-28.md": HASH, "testquery.txt": HASH })
const RECEIPT = z.strictObject({ schema_version: z.literal(1), task: z.literal(18), title: z.literal("Add a fresh evidence-aware Phase-B scope verifier and run all global gates"), base_oid: OID, head_oid: OID, provenance: z.strictObject({ kind: z.literal("current-head-command"), output_prefix: z.literal("task-18-"), captured_at: z.iso.datetime() }), source_files: z.array(FILE_HASH).min(1), test_files: z.array(FILE_HASH).min(1), tdd: z.strictObject({ red_exit_code: z.literal(1), red_reason: z.literal("missing verifier module") }), semantic_tests: z.array(SEMANTIC).length(SEMANTIC_TESTS.length), commands: z.array(COMMAND).length(COMMAND_NAMES.length) })
const FINAL_MANIFEST = z.strictObject({ schema_version: z.literal(1), planning_base: OID, live_head: OID, tracked_status: z.string(), working_tree_patch_sha256: HASH, commit_range_paths: z.array(z.string()), tracked_worktree_paths: z.array(z.string()), changed_tracked_paths: z.array(z.string()), untracked_product_files: z.array(FILE_HASH), baseline_manifest_sha256: HASH, required_receipts: z.record(z.string(), HASH), protected_path_sha256: ROOT_HASHES, layer_zero_fixture_sha256: FIXTURE_HASHES, phase_a_v1_fixture_sha256: V1_HASHES, generated_schema_sha256: HASH, commands: z.array(COMMAND).length(COMMAND_NAMES.length) })
const BASELINE = z.strictObject({ task: z.unknown(), planning_base: OID, phase_a_scope_verifier_base: OID, phase_a_scope_verifier_base_semantics: z.unknown(), live_head: z.literal(OPENMATH_RESEARCH_PHASE_B_BASE), accepted_untracked_inventory: z.array(z.strictObject({ path: z.string(), category: z.string(), sha256: HASH })), inventory_scope: z.unknown(), commands: z.unknown(), mutation_probes: z.unknown(), generated_schema: z.unknown(), protected_root_sha256: ROOT_HASHES, adversarial_classes: z.unknown(), not_applicable: z.unknown(), cleanup_receipt: z.unknown(), inventory_self_hash_exclusion: z.unknown(), volatile_orchestration_policy: z.strictObject({ exact_paths: z.array(z.string()), path_prefixes: z.array(z.string()), reason: z.unknown(), validator_requirement: z.unknown() }) })

const ROOT_EXPECTED = { "failurecase.md": "56d78008da99dbaf5f115e9bf6314749c2d1617207990f505f413f2f6e907568", "session-ses_22ce.md": "31d25a1e51c3622bece3e901adbb6edb4269f9780658dee7fcd7e18aafe76af6", "session-summary-openmath-debugging-2026-04-28.md": "bd6c26d0be19f0287a942443e8f991f39acaca0ba1b0d8322746519cca86cb83", "testquery.txt": "d170a87c93e45c55d5d851b11c3989c1205881a3bef70c722d04c8d44d103f9f" } as const
const LAYER_ZERO_EXPECTED = { "src/tools/openmath-workflow-contracts.test.ts": "565895210c3579413fe9b7a31e8af097a523cb75ac5c2f6f7201d6f7b35a7e58", "src/tools/openmath-workflow-happy.test.ts": "738903a05a56e714371de69d94b825a6fcd8f00a1263e0a405182a52ae89eaa1", "src/openmath/workflow/e2e.test.ts": "63e29992645735410b335279e5b4258879120430f3e6e82c6f85ccb468277e57", "src/openmath/workflow/e2e-fixture.ts": "e50f2f5294faa48a6b634209611f3db7d2148d6a38428a74872dfddbf29f01b5", "src/openmath/workflow/transitions/legality-matrix.test.ts": "25ca6d3472a7299b959d8e11b1b4af80a16dbf81325f34dd6213a46e9389498f", "src/openmath/workflow/transitions/checkpoint-matrix.test.ts": "e9b780c3ffa828817a951379e5db49a85a6ea6f5aad5262cc0fe7ecec97fa051", "src/tools/__snapshots__/openmath-workflow-contracts.test.ts.snap": "332968d5ba1f1db7b3d4a4a41216fb8b48a41a95f5afcab1f8a3f1d15a766a36" } as const
const V1_EXPECTED = { "src/openmath/research/compatibility/old-profile-baseline.fixture.ts": "e20200803586fb192165b3a30ed64a8d9b17769135a04acc9d77e2c80af42184", "src/openmath/research/compatibility/old-profile-baseline.test.ts": "e93b575c1dacad65eb23cb8d208ba77468354e39e16d3760a12fb2a6eed52819" } as const
const TOOL_KEYS = new Set(["OpenMathResearchStartToolKey", "OpenMathResearchStatusToolKey", "OpenMathResearchStepToolKey", "OpenMathResearchAmendToolKey", "OpenMathResearchPromoteToolKey", "OpenMathResearchAbortToolKey"])
const FORBIDDEN_IMPORTS = new Set(["node:child_process", "child_process", "shelljs", "execa"])
const FORBIDDEN_CALLS = new Set(["task_create", "task_update", "schedule_continuation", "continue_campaign", "write_canonical", "canonical_promote", "openmath_export", "refine_authority"])
const BUN_EXECUTION_CALLS = new Set(["spawn", "spawnSync", "$"])
const FORBIDDEN_IDENTIFIERS = new Set(["counterexample_backend", "executable_backend", "shell_command", "machine_proof", "proof_certificate", "independence_group", "provider_diversity", "adaptive_search", "novelty_search", "experience_bank", "meta_eval", "agent_variant", "self_modification", "evidence_carry_forward", "carry_forward_evidence", "phase_c", "phase_d", "layer_2"])
const RESERVED_EVIDENCE = new Set(["EXECUTABLE_TEST", "FINITE_EXHAUSTIVE_SEARCH", "CAS", "SMT", "LEAN_KERNEL", "HUMAN_DOMAIN_EXPERT"])
const TRUE_FLAGS = new Set(["canonical", "mathematical_correctness_certified", "machine_checked", "formally_verified", "exhaustive"])
const PROTECTED_PREFIXES = ["src/openmath/workflow/state/", "src/openmath/workflow/transitions/", "src/openmath/workflow/adapters/"] as const
const ALLOWED_EXACT_PATHS = new Set(["src/agents/builtin-agents/replacement-prompt-resolver.ts"])
const ALLOWED_PREFIXES = ["assets/oh-my-openmath.schema.json", "docs/", "script/verify-openmath-research-phase-b-scope", "script/verify-openmath-research-phase-b-receipts", "src/openmath/research/", "src/openmath/revision-store/", "src/openmath/workflow/stage-runner/sha256.ts", "src/openmath/workflow/storage/", "src/tools/openmath-research-"] as const

export class PhaseBScopeError extends Error { readonly name = "PhaseBScopeError" }
const sha256 = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex"); const sortedUnique = (values: readonly string[]): readonly string[] => [...new Set(values)].sort()
const same = (left: readonly string[], right: readonly string[]): boolean => JSON.stringify(left) === JSON.stringify(right)
const lines = (value: string): readonly string[] => value.split("\n").filter(Boolean)
function git(root: string, args: readonly string[]): string { const result = spawnSync("git", args, { cwd: root, encoding: "utf8" }); if (result.status !== 0) throw new PhaseBScopeError(result.stderr.trim()); return result.stdout }
function parseFile<T>(path: string, schema: z.ZodType<T>): T { const bytes = readFileSync(path); return schema.parse(JSON.parse(bytes.toString("utf8"))) }
function hashes(root: string, expected: Readonly<Record<string, string>>): Readonly<Record<string, string>> { return Object.fromEntries(Object.keys(expected).map((path) => [path, existsSync(resolve(root, path)) ? sha256(readFileSync(resolve(root, path))) : "missing"])) }
function productPath(path: string): boolean { return path.startsWith("src/") || path.startsWith("docs/") || path.startsWith("script/") || path.startsWith("assets/") }
function productionTypeScript(path: string): boolean { return /\.tsx?$/.test(path) && !/\.(?:test|spec)\.tsx?$/.test(path) }

type AcceptedInventoryEntry = Readonly<{ path: string; category: string; sha256: string }>; type CommandOutputHash = Readonly<{ name: string; stdout_sha256: string; stderr_sha256: string }>; type CommandReceipt = CommandOutputHash & Readonly<{ command: string; exit_code: number; expected_exit_code: number }>

export function verifyAcceptedInventoryHashes(root: string, entries: readonly AcceptedInventoryEntry[]): readonly string[] {
  const mutableCategories = new Set(["notepad", "plan", "generated-binary"])
  return entries
    .filter((entry) => !mutableCategories.has(entry.category))
    .filter((entry) => !existsSync(resolve(root, entry.path)) || sha256(readFileSync(resolve(root, entry.path))) !== entry.sha256)
    .map((entry) => `Accepted untracked byte hash mismatch: ${entry.path}`)
}

export function verifyCommandOutputHashes(root: string, evidenceDirectory: string, commands: readonly CommandOutputHash[]): readonly string[] {
  const evidence = resolve(root, evidenceDirectory)
  const failures = commands.flatMap((command) => (["stderr", "stdout"] as const)
    .filter((stream) => {
      const path = resolve(evidence, `task-18-${command.name}.${stream}`)
      return !existsSync(path) || sha256(readFileSync(path)) !== command[`${stream}_sha256`]
    })
    .map((stream) => `Command ${stream} byte hash mismatch: ${command.name}`))
  return failures.sort()
}

export function verifyCommandReceipts(commands: readonly CommandReceipt[]): readonly string[] {
  const failures: string[] = []
  if (!same(commands.map((command) => command.name).sort(), [...COMMAND_NAMES].sort())) failures.push("Global command receipts are incomplete")
  for (const name of COMMAND_NAMES) { const recorded = commands.find((command) => command.name === name)
    if (recorded && recorded.command !== `/usr/bin/bash -o pipefail -c "${COMMAND_TEXT[name]}"`) failures.push(`Required command text mismatch: ${name}`)
    if (recorded && (recorded.exit_code !== 0 || recorded.expected_exit_code !== 0)) failures.push(`Required command did not exit zero: ${name}`) }
  return failures.sort()
}

export function verifyPhaseBSourceScope(changedPaths: readonly string[], sources: ReadonlyMap<string, string>, toolRegistrySource: string): readonly string[] {
  const failures: string[] = []
  for (const path of changedPaths) {
    if (PROTECTED_PREFIXES.some((prefix) => path.startsWith(prefix)) || path === "src/openmath/workflow/profile-schema.ts" || path === "src/openmath/workflow/builtin-profiles.ts") failures.push(`Protected Layer-0 path changed: ${path}`)
    else if (path.startsWith("src/openmath/research/") && /(?:^|[/_.-])(?:phase[-_]?c|phase[-_]?d|layer[-_]?2|executable[-_]?backend)(?:$|[/_.-])/i.test(path)) failures.push(`Forbidden later-phase/backend path: ${path}`)
    else if (!ALLOWED_EXACT_PATHS.has(path) && !ALLOWED_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix))) failures.push(`Path is outside the Phase-B allowlist: ${path}`)
  }
  for (const [path, source] of sources) {
    const scan = scanTypeScript(path, source)
    if (productionTypeScript(path) && scan.logicLines > 200) failures.push(`${path}: ${scan.logicLines} logic LOC exceeds 200`)
    if (path.endsWith("/index.ts") && scan.hasIndexBusinessLogic) failures.push(`${path}: business logic in index.ts is forbidden`)
    if (scan.hasAnyAssertion) failures.push(`${path}: as any is forbidden`)
    if (scan.hasSuppressionDirective) failures.push(`${path}: TypeScript suppression directives are forbidden`)
    if (productionTypeScript(path) && path !== "script/verify-openmath-research-phase-b-scope.ts") failures.push(...scanForbiddenAst(path, source))
  }
  const registry = ts.createSourceFile("src/tools/openmath-research-tools.ts", toolRegistrySource, ts.ScriptTarget.Latest, true)
  const observed = new Set<string>()
  const visitRegistry = (node: ts.Node): void => { if (ts.isIdentifier(node) && /^OpenMathResearch\w+ToolKey$/.test(node.text)) observed.add(node.text); ts.forEachChild(node, visitRegistry) }
  visitRegistry(registry)
  if (!same([...observed].sort(), [...TOOL_KEYS].sort())) failures.push(`Research tool registry must expose exactly six tools; observed ${[...observed].sort().join(",")}`)
  return failures.sort()
}

function scanForbiddenAst(path: string, source: string): readonly string[] {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true)
  const failures: string[] = []
  const fail = (rule: string, node: ts.Node, value: string): void => {
    failures.push(`${path}:${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${rule}: ${value}`)
  }
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && FORBIDDEN_IMPORTS.has(node.moduleSpecifier.text)) fail("executable/backend import is forbidden", node, node.moduleSpecifier.text)
    if (ts.isImportSpecifier(node) && FORBIDDEN_CALLS.has(node.propertyName?.text ?? node.name.text)) fail("executable/continuation/canonical import is forbidden", node, node.propertyName?.text ?? node.name.text)
    if (ts.isIdentifier(node) && FORBIDDEN_IDENTIFIERS.has(node.text)) fail("later-phase/backend surface is forbidden", node, node.text)
    if (ts.isPropertyAssignment(node) && ((ts.isIdentifier(node.name) && TRUE_FLAGS.has(node.name.text)) || (ts.isStringLiteral(node.name) && TRUE_FLAGS.has(node.name.text)) || (ts.isComputedPropertyName(node.name) && ts.isStringLiteral(node.name.expression) && TRUE_FLAGS.has(node.name.expression.text))) && node.initializer.kind === ts.SyntaxKind.TrueKeyword) fail("machine/canonical claim is forbidden", node, node.name.getText(file))
    if (ts.isPropertyAccessExpression(node) && FORBIDDEN_CALLS.has(node.name.text)) fail("executable/continuation/canonical call surface is forbidden", node, node.name.text)
    if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression) && FORBIDDEN_CALLS.has(node.argumentExpression.text)) fail("executable/continuation/canonical call surface is forbidden", node, node.argumentExpression.text)
    if (ts.isCallExpression(node)) {
      const called = ts.isIdentifier(node.expression) ? node.expression.text : undefined
      if (called !== undefined && FORBIDDEN_CALLS.has(called)) fail("executable/continuation/canonical call is forbidden", node, called)
      if (ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "Bun" && BUN_EXECUTION_CALLS.has(node.expression.name.text)) fail("executable/continuation/canonical call is forbidden", node, node.expression.name.text)
      if (ts.isElementAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "Bun" && ts.isStringLiteral(node.expression.argumentExpression) && BUN_EXECUTION_CALLS.has(node.expression.argumentExpression.text)) fail("executable/continuation/canonical call is forbidden", node, node.expression.argumentExpression.text)
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && FORBIDDEN_IMPORTS.has(node.arguments[0].text)) fail("executable/backend dynamic import is forbidden", node, node.arguments[0].text)
      if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "literal" && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && RESERVED_EVIDENCE.has(node.arguments[0].text)) fail("broad evidence-ingress schema is forbidden", node, node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return failures
}

export function verifyPhaseBEvidence(root: string, evidenceDirectory: string, requestedBase: string): readonly string[] {
  const failures: string[] = []
  const evidence = resolve(root, evidenceDirectory)
  const finalPath = resolve(evidence, "final-manifest.json")
  const baselinePath = resolve(evidence, "baseline-manifest.json")
  const receiptPath = resolve(evidence, "task-18-receipt.json")
  const final = parseFile(finalPath, FINAL_MANIFEST)
  const baselineBytes = readFileSync(baselinePath)
  const receiptBytes = readFileSync(receiptPath)
  const baseline = BASELINE.parse(JSON.parse(baselineBytes.toString("utf8")))
  const receipt = RECEIPT.parse(JSON.parse(receiptBytes.toString("utf8")))
  const head = git(root, ["rev-parse", "HEAD"]).trim()
  if (requestedBase !== OPENMATH_RESEARCH_PHASE_B_BASE || final.planning_base !== requestedBase || baseline.planning_base !== requestedBase) failures.push(`Planning base must be ${OPENMATH_RESEARCH_PHASE_B_BASE}`)
  if (final.live_head !== head || receipt.head_oid !== head || receipt.base_oid !== requestedBase) failures.push("Evidence is stale for the requested base or current HEAD")
  if (sha256(baselineBytes) !== final.baseline_manifest_sha256) failures.push("Baseline manifest byte hash mismatch")
  failures.push(...verifyTaskReceiptChain(root, evidenceDirectory, requestedBase, head, final.required_receipts))
  const commitPaths = sortedUnique(lines(git(root, ["diff", "--name-only", "--diff-filter=ACMRD", `${requestedBase}...HEAD`])))
  const worktreePaths = sortedUnique(lines(git(root, ["diff", "--name-only", "--diff-filter=ACMRD", "HEAD"])))
  const changedTracked = sortedUnique([...commitPaths, ...worktreePaths])
  const allUntracked = sortedUnique(lines(git(root, ["ls-files", "--others", "--exclude-standard"])))
  const productUntracked = allUntracked.filter(productPath)
  if (!same(commitPaths, final.commit_range_paths) || !same(worktreePaths, final.tracked_worktree_paths) || !same(changedTracked, final.changed_tracked_paths)) failures.push("Tracked changed-path manifest does not match Git")
  if (git(root, ["status", "--short", "--untracked-files=no"]).trimEnd() !== final.tracked_status) failures.push("Tracked status receipt does not match Git")
  if (sha256(git(root, ["diff", "--binary", "HEAD"])) !== final.working_tree_patch_sha256) failures.push("Working-tree patch hash mismatch")
  if (!same(productUntracked, final.untracked_product_files.map((entry) => entry.path))) failures.push("Untracked product inventory does not match Git")
  for (const entry of final.untracked_product_files) if (!existsSync(resolve(root, entry.path)) || sha256(readFileSync(resolve(root, entry.path))) !== entry.sha256) failures.push(`Untracked product byte hash mismatch: ${entry.path}`)
  const accepted = new Set(baseline.accepted_untracked_inventory.map((entry) => entry.path))
  failures.push(...verifyAcceptedInventoryHashes(root, baseline.accepted_untracked_inventory))
  const unknown = allUntracked.filter((path) => !productPath(path) && !accepted.has(path) && !path.startsWith(".omo/evidence/openmath-research-campaign-phase-b/") && !baseline.volatile_orchestration_policy.exact_paths.includes(path) && !baseline.volatile_orchestration_policy.path_prefixes.some((prefix) => path.startsWith(prefix)))
  if (unknown.length > 0) failures.push(`Uninventoried untracked paths: ${unknown.join(",")}`)
  const changedPaths = sortedUnique([...changedTracked, ...productUntracked])
  const sources = new Map(changedPaths.filter((path) => existsSync(resolve(root, path)) && /\.tsx?$/.test(path)).map((path) => [path, readFileSync(resolve(root, path), "utf8")]))
  failures.push(...verifyPhaseBSourceScope(changedPaths, sources, readFileSync(resolve(root, "src/tools/openmath-research-tools.ts"), "utf8")))
  for (const [label, actual, expected, recorded] of [["protected", hashes(root, ROOT_EXPECTED), ROOT_EXPECTED, final.protected_path_sha256], ["Layer-0", hashes(root, LAYER_ZERO_EXPECTED), LAYER_ZERO_EXPECTED, final.layer_zero_fixture_sha256], ["V1", hashes(root, V1_EXPECTED), V1_EXPECTED, final.phase_a_v1_fixture_sha256]] as const) if (JSON.stringify(actual) !== JSON.stringify(expected) || JSON.stringify(recorded) !== JSON.stringify(expected)) failures.push(`${label} fixture hash drift`)
  if (sha256(readFileSync(resolve(root, "assets/oh-my-openmath.schema.json"))) !== final.generated_schema_sha256) failures.push("Generated schema hash mismatch")
  failures.push(...verifyCommandReceipts(receipt.commands))
  if (JSON.stringify(receipt.commands) !== JSON.stringify(final.commands)) failures.push("Final command receipts do not match Task-18 receipt")
  failures.push(...verifyCommandOutputHashes(root, evidenceDirectory, receipt.commands))
  for (const expected of SEMANTIC_TESTS) {
    const recorded = receipt.semantic_tests.find((test) => test.claim === expected.claim)
    const source = readFileSync(resolve(root, expected.path), "utf8")
    const testFile = ts.createSourceFile(expected.path, source, ts.ScriptTarget.Latest, true)
    let named = false
    const visit = (node: ts.Node): void => { if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "test" && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === expected.name) named = true; ts.forEachChild(node, visit) }
    visit(testFile)
    if (!recorded || recorded.path !== expected.path || recorded.test_name !== expected.name || recorded.sha256 !== sha256(source) || !named) failures.push(`Named semantic test receipt mismatch: ${expected.claim}`)
  }
  return sortedUnique(failures)
}

if (import.meta.main) {
  const baseIndex = process.argv.indexOf("--base")
  const evidenceIndex = process.argv.indexOf("--evidence")
  const base = baseIndex >= 0 ? process.argv[baseIndex + 1] : undefined
  const evidence = evidenceIndex >= 0 ? process.argv[evidenceIndex + 1] : undefined
  if (base === undefined || evidence === undefined) throw new PhaseBScopeError("Usage: bun run script/verify-openmath-research-phase-b-scope.ts --base <base> --evidence <directory>")
  const failures = verifyPhaseBEvidence(process.cwd(), evidence, base)
  if (failures.length > 0) throw new PhaseBScopeError(failures.join("\n"))
  console.log("OpenMath research Phase B evidence and scope verification passed.")
}
