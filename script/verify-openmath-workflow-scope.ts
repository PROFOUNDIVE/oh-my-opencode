import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"

export const OPENMATH_WORKFLOW_BASE = "e3dba8329718052e672ebddea9b89caa3e207582"
const FIRST_COMMIT_PATHS = ["src/openmath/storage-write-fallback.test.ts", "src/openmath/storage.ts"]
const USER_OWNED_PATHS = ["failurecase.md", "session-ses_22ce.md", "session-summary-openmath-debugging-2026-04-28.md", "testquery.txt"]
const VOLATILE_OMO_PREFIXES = [".omo/drafts/", ".omo/evidence/", ".omo/notepads/", ".omo/plans/", ".omo/run-continuation/", ".omo/start-work/"]
const VOLATILE_OMO_PATHS = new Set([".omo/boulder.json", ".omo/ralph-loop.local.md", ".omo/rules/modular-code-enforcement.md"])
const ALLOWED_PREFIXES = ["src/agents/builtin-agents/", "src/config/", "src/features/builtin-commands/", "src/openmath/", "src/plugin/", "src/tools/"]
const F4_CORRECTIVE_TEST_PATHS = ["bin/platform.test.ts", "script/build-schema.test.ts", "src/cli/__snapshots__/model-fallback-native-providers.test.ts.snap", "src/cli/__snapshots__/model-fallback-provider-scenarios.test.ts.snap", "src/cli/__snapshots__/model-fallback.test.ts.snap", "src/cli/config-manager-model-fallback.test.ts", "src/cli/config-manager-provider-config.test.ts", "src/cli/config-manager.test.ts", "src/cli/install-config.test-fixture.ts", "src/cli/install.test.ts", "src/cli/model-fallback-agent-special-cases.test.ts", "src/cli/model-fallback-native-providers.test.ts", "src/cli/model-fallback-provider-scenarios.test.ts", "src/cli/model-fallback.test.ts", "src/cli/run/session-resolver.test.ts", "src/hooks/auto-update-checker/checker/pinned-version-updater.test.ts", "src/shared/model-availability-availability.test.ts", "src/shared/model-availability-connected-provider-filtering.test.ts", "src/shared/model-availability-connected-providers.test.ts", "src/shared/model-availability-fallback.test.ts", "src/shared/model-availability-fetch.test.ts", "src/shared/model-availability-fuzzy-match.test.ts", "src/shared/model-availability-provider-models-cache.test.ts", "src/shared/model-availability.test-fixture.ts", "src/shared/model-availability.test.ts", "src/shared/opencode-config-dir.test.ts"] as const
const ALLOWED_PATHS = new Set(["README.md", "assets/oh-my-openmath.schema.json", "src/plugin-config.ts", "script/check-modular-code-fixtures.ts", "script/check-modular-code-lexical.test.ts", "script/check-modular-code.test.ts", "script/check-modular-code.ts", "script/modular-code-scanner.ts", "script/prompt-template-owners.ts", "script/verify-openmath-workflow-evidence.ts", "script/verify-openmath-workflow-evidence.test.ts", "script/verify-openmath-workflow-scope.ts", "script/verify-openmath-workflow-scope.test.ts", "docs/configurations.md", "docs/examples/openmath-workflow/SOLVER_MARKDOWN.md", "docs/examples/openmath-workflow/REFERENCE_REVIEWER.md", "docs/examples/openmath-workflow/SOLVER_MARKDOWN_PATCH.md", "docs/examples/openmath-workflow/references.yaml", "docs/examples/openmath-workflow/profile.jsonc", "docs/examples/openmath-workflow/verification-manifest.json", ...F4_CORRECTIVE_TEST_PATHS])
const DEPENDENCY_PATHS = new Set(["package.json", "bun.lock", "bun.lockb", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"])

export type OpenMathWorkflowScopeFacts = Readonly<{
  readonly base: string
  readonly firstCommitParent: string
  readonly firstCommitPaths: readonly string[]
  readonly diffNameStatus: string
  readonly untrackedPaths: string
  readonly initialDirty: string
  readonly initialUntracked: string
  readonly initialUntrackedHashes: string
  readonly hashForPath: (path: string) => string
}>

export function verifyOpenMathWorkflowScope(input: OpenMathWorkflowScopeFacts): readonly string[] {
  const failures: string[] = []
  if (input.base !== OPENMATH_WORKFLOW_BASE) failures.push(`Immutable base must be ${OPENMATH_WORKFLOW_BASE}`)
  if (input.firstCommitParent !== OPENMATH_WORKFLOW_BASE) failures.push("First implementation commit must have the immutable base as its parent")
  if (!samePaths(input.firstCommitPaths, FIRST_COMMIT_PATHS)) failures.push("First implementation commit must contain only the Task 1 storage paths")
  if (!input.initialDirty.includes(" M src/openmath/storage.ts")) failures.push("Task 1 initial dirty capture is missing the storage path")
  for (const path of pathsFromNameStatus(input.diffNameStatus)) {
    if (DEPENDENCY_PATHS.has(path)) failures.push(`Dependency file must remain unchanged: ${path}`)
    else if (path === "src/openmath/artifacts-patch/apply.ts") failures.push(`Patch engine must remain unchanged: ${path}`)
    else if (!isAllowedPath(path)) failures.push(`Path is outside the Task 1-15 allowlist: ${path}`)
  }
  const initialPaths = new Set(lines(input.initialUntracked))
  const hashes = hashMap(input.initialUntrackedHashes)
  for (const path of USER_OWNED_PATHS) if (!initialPaths.has(path) || !hashes.has(path)) failures.push(`Task 1 baseline is missing user-owned file: ${path}`)
  for (const path of lines(input.untrackedPaths)) {
    if (isVolatileOmoPath(path)) continue
    const expectedHash = hashes.get(path)
    if (expectedHash !== undefined && expectedHash === input.hashForPath(path)) continue
    failures.push(expectedHash === undefined ? `Untracked path is outside the Task 1-15 allowlist: ${path}` : `User-owned untracked file changed: ${path}`)
  }
  return failures
}

function lines(value: string): readonly string[] { return value.split("\n").map((line) => line.trim()).filter(Boolean) }
function samePaths(actual: readonly string[], expected: readonly string[]): boolean { return actual.length === expected.length && [...actual].sort().every((path, index) => path === [...expected].sort()[index]) }
function isAllowedPath(path: string): boolean { return ALLOWED_PATHS.has(path) || ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix)) }
function isVolatileOmoPath(path: string): boolean { return VOLATILE_OMO_PATHS.has(path) || VOLATILE_OMO_PREFIXES.some((prefix) => path.startsWith(prefix)) }
function pathsFromNameStatus(value: string): readonly string[] { return lines(value).flatMap((line) => line.split("\t").slice(1)) }
function hashMap(value: string): ReadonlyMap<string, string> { return new Map(lines(value).flatMap((line) => { const match = /^([a-f0-9]{64})  (.+)$/.exec(line); return match ? [[match[2], match[1]]] : [] })) }

function git(args: readonly string[]): string {
  const result = Bun.spawnSync({ cmd: ["git", ...args], stdout: "pipe", stderr: "pipe" })
  if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr).trim())
  return new TextDecoder().decode(result.stdout).trim()
}

function parseCliArgs(args: readonly string[]): ReadonlyMap<string, string> {
  return new Map(Array.from({ length: Math.floor(args.length / 2) }, (_, index) => [args[index * 2] ?? "", args[index * 2 + 1] ?? ""]))
}

if (import.meta.main) {
  const args = parseCliArgs(Bun.argv.slice(2))
  const base = args.get("--base")
  const diff = args.get("--diff")
  const untracked = args.get("--untracked")
  const initialDirty = args.get("--initial-dirty")
  const initialUntracked = args.get("--initial-untracked")
  const initialHashes = args.get("--initial-untracked-hashes")
  if (!base || !diff || !untracked || !initialDirty || !initialUntracked || !initialHashes) throw new Error("Usage: bun run script/verify-openmath-workflow-scope.ts --base <base> --diff <path> --untracked <path> --initial-dirty <path> --initial-untracked <path> --initial-untracked-hashes <path>")
  const commits = lines(git(["rev-list", "--reverse", `${base}..HEAD`]))
  const firstCommit = commits[0]
  if (!firstCommit) throw new Error("No implementation commits found after the immutable base")
  const failures = verifyOpenMathWorkflowScope({ base, firstCommitParent: git(["show", "-s", "--format=%P", firstCommit]), firstCommitPaths: lines(git(["diff-tree", "--no-commit-id", "--name-only", "-r", firstCommit])), diffNameStatus: readFileSync(diff, "utf8"), untrackedPaths: readFileSync(untracked, "utf8"), initialDirty: readFileSync(initialDirty, "utf8"), initialUntracked: readFileSync(initialUntracked, "utf8"), initialUntrackedHashes: readFileSync(initialHashes, "utf8"), hashForPath: (path) => createHash("sha256").update(readFileSync(path)).digest("hex") })
  if (failures.length > 0) throw new Error(failures.join("\n"))
  console.log("OpenMath workflow scope verification passed.")
}
