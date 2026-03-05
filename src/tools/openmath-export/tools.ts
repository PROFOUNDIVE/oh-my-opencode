import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import { readOpenMathSessionState } from "../../openmath/storage"
import type { FrozenArtifacts } from "../../openmath/types"
import { renderStudentSolutionMarkdown, renderTeacherSolutionMarkdown, stripDoubleUnderscoreKeys } from "./markdown"
import { OpenMathExportInputSchema } from "./types"

type OpenMathExportToolDefaults = {
  default_dir?: string
  overwrite?: boolean
  allowed_base_dirs?: string[]
  default_prefix?: string
}

function expandHomeDir(input: string): string {
  if (input === "~") {
    return homedir()
  }

  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return path.join(homedir(), input.slice(2))
  }

  return input
}

function resolveDir(directory: string, input: string): string {
  const expanded = expandHomeDir(input)
  const absolute = path.isAbsolute(expanded) ? expanded : path.resolve(directory, expanded)
  return path.normalize(absolute)
}

function isWithinBaseDir(targetDir: string, baseDir: string): boolean {
  const rel = path.relative(baseDir, targetDir)
  if (rel === "") {
    return true
  }
  if (rel.startsWith(".." + path.sep) || rel === "..") {
    return false
  }
  return !path.isAbsolute(rel)
}

function ensureDirectoryExists(dirPath: string): { ok: true } | { ok: false; error_code: string; message: string } {
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

function validatePrefix(prefix: string): { ok: true } | { ok: false; error_code: string; message: string } {
  if (prefix.length === 0) {
    return { ok: false, error_code: "INVALID_PREFIX", message: "prefix must be non-empty" }
  }

  if (prefix.includes("\u0000")) {
    return { ok: false, error_code: "INVALID_PREFIX", message: "prefix must not contain NUL" }
  }

  if (prefix.includes("/") || prefix.includes("\\") || prefix.includes(path.sep)) {
    return { ok: false, error_code: "INVALID_PREFIX", message: "prefix must not contain path separators" }
  }

  return { ok: true }
}

function defaultAllowedBaseDirs(directory: string): string[] {
  const allowed: string[] = [path.normalize(path.resolve(directory))]
  const candidate = path.join(homedir(), "test", "openmath-test")
  if (existsSync(candidate)) {
    allowed.push(path.normalize(path.resolve(candidate)))
  }
  return allowed
}

function getFrozenArtifactsOrError(
  directory: string,
  sessionId: string,
): { ok: true; artifacts: FrozenArtifacts } | { ok: false; error_code: string; message: string } {
  const state = readOpenMathSessionState(directory, sessionId)
  if (!state) {
    return { ok: false, error_code: "STATE_NOT_FOUND", message: `OpenMath state not found for session_id=${sessionId}` }
  }

  if (!state.frozen_artifacts) {
    return { ok: false, error_code: "ARTIFACTS_MISSING", message: "OpenMath state has no frozen_artifacts" }
  }

  return { ok: true, artifacts: state.frozen_artifacts }
}

export function createOpenMathExportTool(
  directory: string,
  defaults?: OpenMathExportToolDefaults,
): ToolDefinition {
  return tool({
    description: "Export deterministic OpenMath student/teacher markdown artifacts from state.frozen_artifacts.",
    args: {
      session_id: tool.schema.string().describe("OpenMath session id to export"),
      dir: tool.schema.string().optional().describe("Target directory to write exports"),
      prefix: tool.schema.string().optional().describe("File prefix (defaults to config or session_id)"),
      overwrite: tool.schema.boolean().optional().describe("If true, allow overwriting existing files"),
    },
    execute: async (args: Record<string, unknown>) => {
      try {
        const validatedArgs = OpenMathExportInputSchema.parse(args)

        const effectiveOverwrite = validatedArgs.overwrite ?? defaults?.overwrite ?? false

        const allowedBaseDirsRaw = defaults?.allowed_base_dirs
        const allowedBaseDirs = (allowedBaseDirsRaw && allowedBaseDirsRaw.length > 0
          ? allowedBaseDirsRaw.map((d) => resolveDir(directory, d))
          : defaultAllowedBaseDirs(directory)
        ).map((d) => path.normalize(path.resolve(d)))

        const defaultDir = defaults?.default_dir
          ? resolveDir(directory, defaults.default_dir)
          : existsSync(path.join(homedir(), "test", "openmath-test"))
            ? path.join(homedir(), "test", "openmath-test")
            : directory

        const effectiveDirInput = validatedArgs.dir ?? defaultDir
        const targetDir = resolveDir(directory, effectiveDirInput)

        const isAllowed = allowedBaseDirs.some((base) => isWithinBaseDir(targetDir, base))
        if (!isAllowed) {
          return JSON.stringify({
            ok: false,
            error_code: "PATH_NOT_ALLOWED",
            message: `Target dir must be within allowed_base_dirs: ${targetDir}`,
            allowed_base_dirs: allowedBaseDirs,
          })
        }

        const dirOk = ensureDirectoryExists(targetDir)
        if (!dirOk.ok) {
          return JSON.stringify({ ok: false, error_code: dirOk.error_code, message: dirOk.message })
        }

        const prefix = validatedArgs.prefix ?? defaults?.default_prefix ?? validatedArgs.session_id
        const prefixOk = validatePrefix(prefix)
        if (!prefixOk.ok) {
          return JSON.stringify({ ok: false, error_code: prefixOk.error_code, message: prefixOk.message })
        }

        const studentPath = path.join(targetDir, `${prefix}_solution_for_student.md`)
        const teacherPath = path.join(targetDir, `${prefix}_solution_for_teacher.md`)

        if (!effectiveOverwrite) {
          if (existsSync(studentPath) || existsSync(teacherPath)) {
            return JSON.stringify({
              ok: false,
              error_code: "OVERWRITE_REFUSED",
              message: "Refusing to overwrite existing export files without overwrite=true",
              student_path: studentPath,
              teacher_path: teacherPath,
            })
          }
        }

        const artifactsResult = getFrozenArtifactsOrError(directory, validatedArgs.session_id)
        if (!artifactsResult.ok) {
          return JSON.stringify({ ok: false, error_code: artifactsResult.error_code, message: artifactsResult.message })
        }

        const safeArtifacts: FrozenArtifacts = {
          ...artifactsResult.artifacts,
          hint_ladder: stripDoubleUnderscoreKeys(artifactsResult.artifacts.hint_ladder),
          grading_rubric: stripDoubleUnderscoreKeys(artifactsResult.artifacts.grading_rubric),
        }

        const studentMarkdown = renderStudentSolutionMarkdown(safeArtifacts)
        const teacherMarkdown = renderTeacherSolutionMarkdown(safeArtifacts)

        writeFileSync(studentPath, studentMarkdown, "utf-8")
        writeFileSync(teacherPath, teacherMarkdown, "utf-8")

        return JSON.stringify({ ok: true, student_path: studentPath, teacher_path: teacherPath })
      } catch (error) {
        if (error instanceof Error) {
          return JSON.stringify({ ok: false, error_code: "VALIDATION_ERROR", message: error.message })
        }
        return JSON.stringify({ ok: false, error_code: "UNKNOWN_ERROR" })
      }
    },
  })
}
