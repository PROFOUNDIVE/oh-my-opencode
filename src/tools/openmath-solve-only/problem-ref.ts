import { existsSync, realpathSync, statSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"

export type OpenMathProblemRef = {
  file_path: string
  problem_number: number
}

export type ProblemRefFileType = "md" | "tex"

export class ProblemRefNotFoundError extends Error {
  readonly error_code = "PROBLEM_REF_NOT_FOUND" as const
}

type ExtractProblemResult =
  | { ok: true; extracted: string }
  | { ok: false; reason: "not_found" | "ambiguous" }

function expandHomeDir(input: string, effectiveHomedir: string): string {
  if (input === "~") {
    return effectiveHomedir
  }

  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return path.join(effectiveHomedir, input.slice(2))
  }

  return input
}

function cleanProblemRefPath(raw: string): string {
  let s = raw.trim()
  if (s.startsWith("@")) {
    s = s.slice(1).trim()
  }

  if (s.startsWith("[") && s.endsWith("]") && s.length >= 2) {
    s = s.slice(1, -1).trim()
  }

  if (
    (s.startsWith('"') && s.endsWith('"') && s.length >= 2) ||
    (s.startsWith("'") && s.endsWith("'") && s.length >= 2)
  ) {
    s = s.slice(1, -1)
  }

  return s
}

function detectFileType(filePath: string): ProblemRefFileType | null {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === ".md") {
    return "md"
  }
  if (ext === ".tex") {
    return "tex"
  }
  return null
}

function isWithinBaseDir(targetPath: string, baseDir: string): boolean {
  const rel = path.relative(baseDir, targetPath)
  if (rel === "") {
    return true
  }
  if (rel.startsWith(".." + path.sep) || rel === "..") {
    return false
  }
  return !path.isAbsolute(rel)
}

function defaultAllowedBaseDirs(projectDir: string, effectiveHomedir: string): string[] {
  const projectRoot = path.normalize(path.resolve(projectDir))
  const openmathTestRoot = path.normalize(path.resolve(path.join(effectiveHomedir, "test", "openmath-test")))
  return [projectRoot, openmathTestRoot]
}

function safeRealpath(inputPath: string): string | null {
  try {
    return realpathSync(inputPath)
  } catch {
    return null
  }
}

function resolveAndValidateProblemRefPath(args: {
  projectDir: string
  file_path: string
  homedirOverride?: string
}): { ok: true; resolvedPath: string; fileType: ProblemRefFileType } | { ok: false } {
  const effectiveHomedir = args.homedirOverride ?? homedir()
  const cleaned = cleanProblemRefPath(args.file_path)
  const expanded = expandHomeDir(cleaned, effectiveHomedir)
  const absolute = path.isAbsolute(expanded) ? expanded : path.resolve(args.projectDir, expanded)
  const normalized = path.normalize(absolute)

  const fileType = detectFileType(normalized)
  if (!fileType) {
    return { ok: false }
  }

  if (!existsSync(normalized)) {
    return { ok: false }
  }

  const resolvedFile = safeRealpath(normalized)
  if (!resolvedFile) {
    return { ok: false }
  }

  const allowedBaseDirs = defaultAllowedBaseDirs(args.projectDir, effectiveHomedir)
    .map((d) => safeRealpath(d))
    .filter((d): d is string => Boolean(d))

  const isAllowed = allowedBaseDirs.some((base) => isWithinBaseDir(resolvedFile, base))
  if (!isAllowed) {
    return { ok: false }
  }

  return { ok: true, resolvedPath: resolvedFile, fileType }
}

function headerNumberDot(line: string): number | null {
  const m = line.match(/^\s*(\d+)\.(?:\s+|$)/)
  if (!m) {
    return null
  }
  return Number(m[1])
}

function headerProblemNMarkdown(line: string): number | null {
  const m = line.match(/^\s*(?:#+\s*)?Problem\s+(\d+)\b/i)
  if (!m) {
    return null
  }
  return Number(m[1])
}

function headerProblemNTex(line: string): number | null {
  const m = line.match(
    /^\s*\\(?:section|subsection|subsubsection|paragraph|textbf)\*?\s*\{\s*Problem\s+(\d+)\b/i,
  )
  if (!m) {
    return null
  }
  return Number(m[1])
}

function matchAnyProblemHeader(line: string, fileType: ProblemRefFileType): number | null {
  const dot = headerNumberDot(line)
  if (Number.isFinite(dot)) {
    return dot
  }

  const problemN = headerProblemNMarkdown(line)
  if (Number.isFinite(problemN)) {
    return problemN
  }

  if (fileType === "tex") {
    const tex = headerProblemNTex(line)
    if (Number.isFinite(tex)) {
      return tex
    }
  }

  return null
}

export function extractProblemFromText(args: {
  text: string
  fileType: ProblemRefFileType
  problemNumber: number
}): ExtractProblemResult {
  if (!Number.isInteger(args.problemNumber) || args.problemNumber < 1) {
    return { ok: false, reason: "not_found" }
  }

  const lines = args.text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")

  const starts: number[] = []
  for (let i = 0; i < lines.length; i++) {
    const num = matchAnyProblemHeader(lines[i], args.fileType)
    if (num === args.problemNumber) {
      starts.push(i)
      if (starts.length > 1) {
        return { ok: false, reason: "ambiguous" }
      }
    }
  }

  if (starts.length === 0) {
    return { ok: false, reason: "not_found" }
  }

  const start = starts[0]
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    const num = matchAnyProblemHeader(lines[i], args.fileType)
    if (num !== null) {
      end = i
      break
    }
  }

  const extracted = lines.slice(start, end).join("\n").trim()
  if (extracted.length === 0) {
    return { ok: false, reason: "not_found" }
  }

  return { ok: true, extracted }
}

export async function resolveProblemRefToProblemText(args: {
  projectDir: string
  problemRef: OpenMathProblemRef
  homedirOverride?: string
  maxFileBytes?: number
}): Promise<{ resolved_path: string; problem: string }> {
  const resolved = resolveAndValidateProblemRefPath({
    projectDir: args.projectDir,
    file_path: args.problemRef.file_path,
    homedirOverride: args.homedirOverride,
  })

  if (!resolved.ok) {
    throw new ProblemRefNotFoundError("problem_ref not found")
  }

  const maxBytes = args.maxFileBytes ?? 2_000_000
  try {
    const stats = statSync(resolved.resolvedPath)
    if (!stats.isFile() || stats.size > maxBytes) {
      throw new ProblemRefNotFoundError("problem_ref not found")
    }
  } catch {
    throw new ProblemRefNotFoundError("problem_ref not found")
  }

  const text = await readFile(resolved.resolvedPath, "utf-8")
  const extracted = extractProblemFromText({
    text,
    fileType: resolved.fileType,
    problemNumber: args.problemRef.problem_number,
  })

  if (!extracted.ok) {
    throw new ProblemRefNotFoundError("problem_ref not found")
  }

  return { resolved_path: resolved.resolvedPath, problem: extracted.extracted }
}
