import { existsSync, writeFileSync } from "node:fs"
import path from "node:path"

export function resolveExportPaths(targetDir: string, prefix: string): {
  studentPath: string
  teacherPath: string
} {
  return {
    studentPath: path.join(targetDir, `${prefix}_solution_for_student.md`),
    teacherPath: path.join(targetDir, `${prefix}_solution_for_teacher.md`),
  }
}

export function ensureWritableExportPaths(args: {
  studentPath: string
  teacherPath: string
  overwrite: boolean
}): { ok: true } | { ok: false; error_code: "OVERWRITE_REFUSED"; message: string } {
  if (args.overwrite) {
    return { ok: true }
  }

  if (existsSync(args.studentPath) || existsSync(args.teacherPath)) {
    return {
      ok: false,
      error_code: "OVERWRITE_REFUSED",
      message: "Refusing to overwrite existing export files without overwrite=true",
    }
  }

  return { ok: true }
}

export function writeExportMarkdown(args: {
  studentPath: string
  teacherPath: string
  studentMarkdown: string
  teacherMarkdown: string
}): void {
  writeFileSync(args.studentPath, args.studentMarkdown, "utf-8")
  writeFileSync(args.teacherPath, args.teacherMarkdown, "utf-8")
}
