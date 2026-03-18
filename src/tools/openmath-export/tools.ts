import { existsSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import type { FrozenArtifacts } from "../../openmath/types"
import { renderStudentSolutionMarkdown, renderTeacherSolutionMarkdown, stripDoubleUnderscoreKeys } from "./markdown"
import { OpenMathExportInputSchema } from "./types"
import {
  defaultAllowedBaseDirs,
  ensureDirectoryExists,
  isWithinBaseDir,
  resolveDir,
} from "./dir-resolution"
import { validatePrefix } from "./prefix-validation"
import { getFrozenArtifactsOrError } from "./export-state-reader"
import {
  ensureWritableExportPaths,
  resolveExportPaths,
  writeExportMarkdown,
} from "./export-file-writer"

type OpenMathExportToolDefaults = {
  default_dir?: string
  overwrite?: boolean
  allowed_base_dirs?: string[]
  default_prefix?: string
}

function resolveAllowedBaseDirs(directory: string, defaults?: OpenMathExportToolDefaults): string[] {
  const configured = defaults?.allowed_base_dirs
  const bases = configured && configured.length > 0
    ? configured.map((d) => resolveDir(directory, d))
    : defaultAllowedBaseDirs(directory)
  return bases.map((d) => path.normalize(path.resolve(d)))
}

function resolveDefaultDir(directory: string, defaults?: OpenMathExportToolDefaults): string {
  if (defaults?.default_dir) {
    return resolveDir(directory, defaults.default_dir)
  }

  const homeCandidate = path.join(homedir(), "test", "openmath-test")
  return existsSync(homeCandidate) ? homeCandidate : directory
}

function sanitizeArtifacts(artifacts: FrozenArtifacts): FrozenArtifacts {
  return {
    ...artifacts,
    hint_ladder: stripDoubleUnderscoreKeys(artifacts.hint_ladder),
    grading_rubric: stripDoubleUnderscoreKeys(artifacts.grading_rubric),
  }
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

        const allowedBaseDirs = resolveAllowedBaseDirs(directory, defaults)
        const effectiveDirInput = validatedArgs.dir ?? resolveDefaultDir(directory, defaults)
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

        const { studentPath, teacherPath } = resolveExportPaths(targetDir, prefix)
        const writable = ensureWritableExportPaths({ studentPath, teacherPath, overwrite: effectiveOverwrite })
        if (!writable.ok) {
          return JSON.stringify({
            ok: false,
            error_code: writable.error_code,
            message: writable.message,
            student_path: studentPath,
            teacher_path: teacherPath,
          })
        }

        const artifactsResult = getFrozenArtifactsOrError(directory, validatedArgs.session_id)
        if (!artifactsResult.ok) {
          return JSON.stringify({ ok: false, error_code: artifactsResult.error_code, message: artifactsResult.message })
        }

        const safeArtifacts = sanitizeArtifacts(artifactsResult.artifacts)
        const studentMarkdown = renderStudentSolutionMarkdown(safeArtifacts, {
          originalProblemText: artifactsResult.originalProblemText,
        })
        const teacherMarkdown = renderTeacherSolutionMarkdown(safeArtifacts, {
          originalProblemText: artifactsResult.originalProblemText,
        })

        writeExportMarkdown({
          studentPath,
          teacherPath,
          studentMarkdown,
          teacherMarkdown,
        })

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
