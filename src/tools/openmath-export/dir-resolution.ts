import { existsSync, mkdirSync, statSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"

export function expandHomeDir(input: string): string {
  if (input === "~") {
    return homedir()
  }

  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return path.join(homedir(), input.slice(2))
  }

  return input
}

export function resolveDir(directory: string, input: string): string {
  const expanded = expandHomeDir(input)
  const absolute = path.isAbsolute(expanded) ? expanded : path.resolve(directory, expanded)
  return path.normalize(absolute)
}

export function isWithinBaseDir(targetDir: string, baseDir: string): boolean {
  const rel = path.relative(baseDir, targetDir)
  if (rel === "") {
    return true
  }
  if (rel.startsWith(".." + path.sep) || rel === "..") {
    return false
  }
  return !path.isAbsolute(rel)
}

export function ensureDirectoryExists(
  dirPath: string,
): { ok: true } | { ok: false; error_code: string; message: string } {
  if (existsSync(dirPath)) {
    try {
      const stats = statSync(dirPath)
      if (!stats.isDirectory()) {
        return { ok: false, error_code: "DIR_NOT_DIRECTORY", message: `Target dir is not a directory: ${dirPath}` }
      }
      return { ok: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown"
      return { ok: false, error_code: "DIR_STAT_FAILED", message }
    }
  }

  try {
    mkdirSync(dirPath, { recursive: true })
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown"
    return { ok: false, error_code: "DIR_CREATE_FAILED", message }
  }
}

export function defaultAllowedBaseDirs(directory: string): string[] {
  const allowed: string[] = [path.normalize(path.resolve(directory))]
  const candidate = path.join(homedir(), "test", "openmath-test")
  if (existsSync(candidate)) {
    allowed.push(path.normalize(path.resolve(candidate)))
  }
  return allowed
}
