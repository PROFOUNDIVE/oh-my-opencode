import type { ToolContextWithMetadata } from "../delegate-task/types"
import type { OpenMathToolConfig } from "./tool-config"

import { createOpenMathExportTool } from "../openmath-export/tools"

export async function maybeAutoExport(args: {
  directory: string
  config: OpenMathToolConfig | undefined
  ctx: ToolContextWithMetadata
  sessionId: string
  prefix: string
  exportDir?: string
  enabled: boolean
}): Promise<{ student_path: string; teacher_path: string } | undefined> {
  if (!args.enabled) return undefined

  const exportTool = createOpenMathExportTool(args.directory, args.config?.export)
  const exportRaw = await exportTool.execute(
    {
      session_id: args.sessionId,
      ...(args.exportDir ? { dir: args.exportDir } : {}),
      prefix: args.prefix,
    },
    args.ctx as any,
  )

  let exportOut: any
  try {
    exportOut = JSON.parse(String(exportRaw))
  } catch {
    return undefined
  }

  if (exportOut?.ok !== true) return undefined
  if (typeof exportOut.student_path !== "string") return undefined
  if (typeof exportOut.teacher_path !== "string") return undefined

  return { student_path: exportOut.student_path, teacher_path: exportOut.teacher_path }
}
