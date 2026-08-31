import { z } from "zod"

const ExportOptionsShape = {
  dir: z.string().optional(),
  prefix: z.string().optional(),
  overwrite: z.boolean().optional(),
}

export const OpenMathExportInputSchema = z.union([
  z.object({ session_id: z.string().min(1), ...ExportOptionsShape }).strict(),
  z.object({ research_educationalization_id: z.string().min(1), ...ExportOptionsShape }).strict(),
])

export type OpenMathExportInput = z.infer<typeof OpenMathExportInputSchema>

export const OpenMathExportSuccessSchema = z.object({
  ok: z.literal(true),
  student_path: z.string(),
  teacher_path: z.string(),
})

export type OpenMathExportSuccess = z.infer<typeof OpenMathExportSuccessSchema>
