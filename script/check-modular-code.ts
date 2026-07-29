import { scanTypeScript } from "./modular-code-scanner"

const MAX_LOGIC_LINES = 200
const GIT_TIMEOUT_MS = 5_000
const CATCH_ALL_STEMS = new Set(["utils", "helpers", "service", "common"])
const decoder = new TextDecoder()

type ChangedPaths = { readonly ok: true; readonly paths: readonly string[] } | { readonly ok: false; readonly message: string }

function parseBase(args: readonly string[]): string | undefined {
  if (args.length !== 2 || args[0] !== "--base" || !args[1]) return undefined
  return args[1]
}

function getChangedPaths(base: string): ChangedPaths {
  const result = Bun.spawnSync({
    cmd: ["git", "diff", "--name-only", "--diff-filter=ACMR", base],
    stdout: "pipe",
    stderr: "pipe",
    timeout: GIT_TIMEOUT_MS,
  })
  if (result.exitCode !== 0) {
    const message = decoder.decode(result.stderr).trim() || `git diff exited with ${result.exitCode}`
    return { ok: false, message }
  }
  const paths = decoder.decode(result.stdout).split("\n").filter((path) => path.endsWith(".ts") || path.endsWith(".tsx"))
  return { ok: true, paths }
}

function filename(path: string): string {
  const segments = path.split(/[\\/]/)
  return segments.at(-1) ?? path
}

function hasCatchAllFilename(path: string): boolean {
  const name = filename(path)
  const extension = name.endsWith(".tsx") ? ".tsx" : name.endsWith(".ts") ? ".ts" : ""
  return extension !== "" && CATCH_ALL_STEMS.has(name.slice(0, -extension.length))
}

async function checkPath(path: string): Promise<readonly string[]> {
  const violations: string[] = []
  if (hasCatchAllFilename(path)) violations.push(`${path}: catch-all filename is forbidden`)

  let source: string
  try {
    source = await Bun.file(path).text()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return [`${path}: unable to read changed file: ${message}`]
  }

  const scan = scanTypeScript(path, source)
  if (scan.logicLines > MAX_LOGIC_LINES) violations.push(`${path}: ${scan.logicLines} logic LOC exceeds ${MAX_LOGIC_LINES}`)
  if (filename(path) === "index.ts" && scan.hasIndexBusinessLogic) violations.push(`${path}: business logic in index.ts is forbidden`)
  if (scan.hasAnyAssertion) violations.push(`${path}: as any is forbidden`)
  if (scan.hasSuppressionDirective) violations.push(`${path}: TypeScript suppression directives are forbidden`)
  return violations
}

async function main(): Promise<number> {
  const base = parseBase(Bun.argv.slice(2))
  if (!base) {
    console.error("Usage: bun run script/check-modular-code.ts --base <git-ref>")
    return 1
  }
  const changed = getChangedPaths(base)
  if (!changed.ok) {
    console.error(`Unable to collect changed files: ${changed.message}`)
    return 1
  }
  const violations = (await Promise.all(changed.paths.map(checkPath))).flat()
  if (violations.length > 0) {
    console.error(violations.join("\n"))
    return 1
  }
  console.log(`Modular code check passed for ${changed.paths.length} changed TypeScript file(s).`)
  return 0
}

process.exitCode = await main()
