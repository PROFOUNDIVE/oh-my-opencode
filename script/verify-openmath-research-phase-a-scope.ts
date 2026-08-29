import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import ts from "typescript"

import { scanTypeScript } from "./modular-code-scanner"

export const OPENMATH_RESEARCH_PHASE_A_BASE = "f25866afb60e2534a7cbff9d5dec9cfbf9081ae9"
export const OPENMATH_RESEARCH_PHASE_A_DIFF_FILTER = "ACMRD"

const PROTECTED_ROOT_HASHES = new Map([
  ["failurecase.md", "56d78008da99dbaf5f115e9bf6314749c2d1617207990f505f413f2f6e907568"],
  ["session-ses_22ce.md", "31d25a1e51c3622bece3e901adbb6edb4269f9780658dee7fcd7e18aafe76af6"],
  ["session-summary-openmath-debugging-2026-04-28.md", "bd6c26d0be19f0287a942443e8f991f39acaca0ba1b0d8322746519cca86cb83"],
  ["testquery.txt", "d170a87c93e45c55d5d851b11c3989c1205881a3bef70c722d04c8d44d103f9f"],
])
const PROTECTED_WORKFLOW_PREFIXES = [
  "src/openmath/workflow/state/",
  "src/openmath/workflow/transitions/",
  "src/openmath/workflow/adapters/",
] as const
const PROTECTED_WORKFLOW_PATHS = new Set(["src/openmath/workflow/adapters.ts", "src/openmath/workflow/builtin-profiles.ts"])
const ALLOWED_PREFIXES = [
  "docs/examples/openmath-research-campaign/",
  "src/openmath/research/",
  "src/openmath/revision-store/",
  "src/openmath/workflow/application/",
] as const
const ALLOWED_PATHS = new Set([
  "README.md", "assets/oh-my-openmath.schema.json", "docs/configurations.md", "docs/openmath-research-campaigns.md",
  "script/verify-openmath-research-phase-a-scope.ts", "script/verify-openmath-research-phase-a-scope.test.ts",
  "src/config/openmath-research-config.test.ts", "src/config/schema/commands.ts", "src/config/schema/openmath.ts", "src/config/schema/tools.ts",
  "src/features/builtin-commands/commands.test.ts", "src/features/builtin-commands/commands.ts", "src/features/builtin-commands/types.ts",
  "src/features/builtin-commands/research-command-definitions.ts", "src/openmath/workflow/stage-runner/stage-runner-types.ts",
  "src/openmath/workflow/stage-runner/sync-stage-dispatch.test.ts", "src/openmath/workflow/stage-runner/sync-stage-dispatch.ts",
  "src/openmath/workflow/storage/atomic-writer-extraction.test.ts", "src/openmath/workflow/storage/atomic-writer.ts",
  "src/plugin/openmath-research-registry-failure.test.ts", "src/plugin/tool-registry.test.ts", "src/plugin/tool-registry.ts",
  "src/tools/delegate-task/sync-prompt-sender.test.ts", "src/tools/delegate-task/sync-prompt-sender.ts", "src/tools/index.ts",
  "src/tools/openmath-research-test-support.ts", "src/tools/openmath-research-tools.test.ts", "src/tools/openmath-research-tools.ts",
  "src/tools/openmath-solve-only/run-sync-subagent.test.ts", "src/tools/openmath-solve-only/run-sync-subagent.ts",
  "src/tools/openmath-workflow-abort/tools.ts", "src/tools/openmath-workflow-amend/tools.ts", "src/tools/openmath-workflow-shared/request.ts",
  "src/tools/openmath-workflow-start/tools.ts", "src/tools/openmath-workflow-status/tools.ts", "src/tools/openmath-workflow-step/tools.ts",
])
const PHASE_B_D_SIGNATURES = new Set(["obligation_graph", "proof_obligation", "counterexample_backend", "witness_verifier", "lean_command", "formal_verifier", "independence_group", "novelty_search", "diversity_level"])
const CANONICAL_SIGNATURES = new Set(["write_canonical", "canonical_promote", "openmath_export", "refine_authority"])
const CONTINUATION_SIGNATURES = new Set(["task_create", "task_update", "schedule_continuation", "continue_campaign"])
const SIX_TOOLS = new Set(["abort", "amend", "promote", "shared", "start", "status", "step"])
const VOLATILE_OMO_PREFIXES = [".omo/drafts/", ".omo/evidence/", ".omo/notepads/", ".omo/plans/", ".omo/run-continuation/", ".omo/start-work/"] as const
const VOLATILE_OMO_PATHS = new Set([".omo/boulder.json", ".omo/ralph-loop.local.md", ".omo/rules/modular-code-enforcement.md"])
const GENERATED_BINARY_PATHS = new Set([
  "packages/darwin-arm64/bin/oh-my-openmath", "packages/darwin-x64-baseline/bin/oh-my-openmath", "packages/darwin-x64/bin/oh-my-openmath",
  "packages/linux-arm64-musl/bin/oh-my-openmath", "packages/linux-arm64/bin/oh-my-openmath", "packages/linux-x64-baseline/bin/oh-my-openmath",
  "packages/linux-x64-musl-baseline/bin/oh-my-openmath", "packages/linux-x64-musl/bin/oh-my-openmath", "packages/linux-x64/bin/oh-my-openmath",
  "packages/windows-x64-baseline/bin/oh-my-openmath.exe", "packages/windows-x64/bin/oh-my-openmath.exe",
])

export type OpenMathResearchPhaseAScopeFacts = Readonly<{
  readonly base: string
  readonly changedPaths: readonly string[]
  readonly sourceFiles: ReadonlyMap<string, string>
  readonly rootHashesBefore: ReadonlyMap<string, string>
  readonly rootHashesAfter: ReadonlyMap<string, string>
}>

export function verifyOpenMathResearchPhaseAScope(input: OpenMathResearchPhaseAScopeFacts): readonly string[] {
  const failures: string[] = []
  if (input.base !== OPENMATH_RESEARCH_PHASE_A_BASE) failures.push(`Immutable planning base must be ${OPENMATH_RESEARCH_PHASE_A_BASE}`)
  for (const path of input.changedPaths) {
    if (isIgnored(path)) continue
    const tool = /^src\/tools\/openmath-research-([^/]+)\//.exec(path)?.[1]
    if (isProtectedWorkflowPath(path)) failures.push(`Protected workflow path must remain unchanged: ${path}`)
    else if (hasForbiddenSurfacePath(path)) failures.push(`Forbidden Phase B-D surface: ${path}`)
    else if (tool !== undefined && !SIX_TOOLS.has(tool)) failures.push(`Only the six Phase A research tools are allowed: ${path}`)
    else if (!isAllowedPath(path)) failures.push(`Path is outside the Phase A allowlist: ${path}`)
  }
  for (const [path, source] of input.sourceFiles) {
    if (!path.endsWith(".ts") && !path.endsWith(".tsx")) continue
    const scan = scanTypeScript(path, source)
    if (scan.logicLines > 200) failures.push(`${path}: ${scan.logicLines} logic LOC exceeds 200`)
    if (path.endsWith("/index.ts") && scan.hasIndexBusinessLogic) failures.push(`${path}: business logic in index.ts is forbidden`)
    if (scan.hasAnyAssertion) failures.push(`${path}: as any is forbidden`)
    if (scan.hasSuppressionDirective) failures.push(`${path}: TypeScript suppression directives are forbidden`)
    if (!/\.(?:test|spec)\.tsx?$/.test(path)) failures.push(...forbiddenSignatures(path, source))
  }
  for (const [path, before] of input.rootHashesBefore) {
    if (input.rootHashesAfter.get(path) !== before) failures.push(`Protected root file hash changed: ${path}`)
  }
  return failures.sort()
}

function forbiddenSignatures(path: string, source: string): readonly string[] {
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true)
  const failures: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isImportSpecifier(node)) {
      const imported = node.propertyName?.text ?? node.name.text
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1
      if (CANONICAL_SIGNATURES.has(imported)) failures.push(`Canonical export/write signature is forbidden: ${imported} in ${path}:${line}`)
      if (CONTINUATION_SIGNATURES.has(imported)) failures.push(`Continuation/task-dispatch signature is forbidden: ${imported} in ${path}:${line}`)
    }
    if (ts.isIdentifier(node)) {
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1
      if (PHASE_B_D_SIGNATURES.has(node.text)) failures.push(`Forbidden Phase B-D signature: ${node.text} in ${path}:${line}`)
      const isCalled = ts.isCallExpression(node.parent) && node.parent.expression === node
        || ts.isPropertyAccessExpression(node.parent) && node.parent.name === node && ts.isCallExpression(node.parent.parent) && node.parent.parent.expression === node.parent
      if (isCalled) {
        if (CANONICAL_SIGNATURES.has(node.text)) failures.push(`Canonical export/write signature is forbidden: ${node.text} in ${path}:${line}`)
        if (CONTINUATION_SIGNATURES.has(node.text)) failures.push(`Continuation/task-dispatch signature is forbidden: ${node.text} in ${path}:${line}`)
      }
    }
    if (ts.isCallExpression(node) && ts.isElementAccessExpression(node.expression) && ts.isStringLiteral(node.expression.argumentExpression)) {
      const signature = node.expression.argumentExpression.text
      const line = sourceFile.getLineAndCharacterOfPosition(node.expression.argumentExpression.getStart()).line + 1
      if (PHASE_B_D_SIGNATURES.has(signature)) failures.push(`Forbidden Phase B-D signature: ${signature} in ${path}:${line}`)
      if (CANONICAL_SIGNATURES.has(signature)) failures.push(`Canonical export/write signature is forbidden: ${signature} in ${path}:${line}`)
      if (CONTINUATION_SIGNATURES.has(signature)) failures.push(`Continuation/task-dispatch signature is forbidden: ${signature} in ${path}:${line}`)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return failures
}

function isProtectedWorkflowPath(path: string): boolean { return PROTECTED_WORKFLOW_PATHS.has(path) || path.startsWith("src/openmath/workflow/profile-") || PROTECTED_WORKFLOW_PREFIXES.some((prefix) => path.startsWith(prefix)) }
function hasForbiddenSurfacePath(path: string): boolean { return path.startsWith("src/openmath/research/") && /(?:obligation|counterexample|witness|(?:^|[/_.-])lean(?:$|[/_.-])|formal|novelty|diversity|independence)/i.test(path) }
function isAllowedPath(path: string): boolean { return ALLOWED_PATHS.has(path) || ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix)) || isAllowedResearchToolDirectory(path) || path.startsWith("src/features/builtin-commands/templates/openmath-research-") }
function isAllowedResearchToolDirectory(path: string): boolean { const tool = /^src\/tools\/openmath-research-([^/]+)\//.exec(path)?.[1]; return tool !== undefined && SIX_TOOLS.has(tool) }
function isIgnored(path: string): boolean { return PROTECTED_ROOT_HASHES.has(path) || GENERATED_BINARY_PATHS.has(path) || VOLATILE_OMO_PATHS.has(path) || VOLATILE_OMO_PREFIXES.some((prefix) => path.startsWith(prefix)) }

function git(args: readonly string[]): readonly string[] {
  const result = spawnSync("git", args, { encoding: "utf8" })
  if (result.status !== 0) throw new TypeError(result.stderr.trim())
  return result.stdout.split("\n").filter(Boolean)
}

if (import.meta.main) {
  const baseIndex = process.argv.indexOf("--base")
  const evidenceIndex = process.argv.indexOf("--evidence")
  const base = baseIndex >= 0 ? process.argv[baseIndex + 1] : undefined
  if (base === undefined || evidenceIndex < 0 || process.argv[evidenceIndex + 1] === undefined) throw new TypeError("Usage: bun run script/verify-openmath-research-phase-a-scope.ts --base <base> --evidence <directory>")
  const changedPaths = [...git(["diff", "--name-only", `--diff-filter=${OPENMATH_RESEARCH_PHASE_A_DIFF_FILTER}`, base]), ...git(["ls-files", "--others", "--exclude-standard"])]
  const sourceFiles = new Map(changedPaths.filter((path) => existsSync(path) && /\.tsx?$/.test(path)).map((path) => [path, readFileSync(path, "utf8")]))
  const rootHashesAfter = new Map([...PROTECTED_ROOT_HASHES].map(([path]) => [path, existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : "missing"]))
  const failures = verifyOpenMathResearchPhaseAScope({ base, changedPaths, sourceFiles, rootHashesBefore: PROTECTED_ROOT_HASHES, rootHashesAfter })
  if (failures.length > 0) throw new TypeError(failures.join("\n"))
  console.log("OpenMath research Phase A scope verification passed.")
}
