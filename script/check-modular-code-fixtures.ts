import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

const checkerPath = join(import.meta.dir, "check-modular-code.ts")
const decoder = new TextDecoder()

export type CheckerFixtureDirectories = string[]

function runGit(directory: string, args: readonly string[]): string {
  const result = Bun.spawnSync({ cmd: ["git", ...args], cwd: directory, stdout: "pipe", stderr: "pipe" })
  const output = `${decoder.decode(result.stdout)}${decoder.decode(result.stderr)}`
  if (result.exitCode !== 0) throw new Error(output)
  return decoder.decode(result.stdout).trim()
}

export function removeFixtureDirectories(directories: CheckerFixtureDirectories): void {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
}

export function checkChangedFile(
  directories: CheckerFixtureDirectories,
  path: string,
  contents: string,
): { readonly exitCode: number; readonly output: string } {
  const directory = mkdtempSync(join(tmpdir(), "openmath-modular-code-"))
  directories.push(directory)
  const filePath = join(directory, path)
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, "export const baseline = true\n", "utf8")
  runGit(directory, ["init", "--quiet"])
  runGit(directory, ["add", "."])
  runGit(directory, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--quiet", "-m", "baseline"])
  const base = runGit(directory, ["rev-parse", "HEAD"])
  writeFileSync(filePath, contents, "utf8")
  const result = Bun.spawnSync({
    cmd: ["bun", "run", checkerPath, "--base", base],
    cwd: directory,
    stdout: "pipe",
    stderr: "pipe",
  })
  return { exitCode: result.exitCode, output: `${decoder.decode(result.stdout)}${decoder.decode(result.stderr)}` }
}
