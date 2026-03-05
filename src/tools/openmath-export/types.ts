import { z } from "zod"

export const OpenMathExportInputSchema = z.object({
  session_id: z.string(),
  dir: z.string().optional(),
  prefix: z.string().optional(),
  overwrite: z.boolean().optional(),
})

export type OpenMathExportInput = z.infer<typeof OpenMathExportInputSchema>

export const OpenMathExportSuccessSchema = z.object({
  ok: z.literal(true),
  student_path: z.string(),
  teacher_path: z.string(),
})

export type OpenMathExportSuccess = z.infer<typeof OpenMathExportSuccessSchema>
