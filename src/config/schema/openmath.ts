import { z } from "zod"

const OpenMathArtifactsFormatSchema = z.enum(["json", "markdown"])

const OpenMathArtifactsPatchConfigSchema = z
  .object({
    max_ops: z.number().int().min(1).optional(),
    allow_unique_substring_replace: z.boolean().optional(),
  })
  .optional()

const OpenMathArtifactsConfigSchema = z
  .object({
    format: OpenMathArtifactsFormatSchema.default("markdown"),
    patch: OpenMathArtifactsPatchConfigSchema,
  })
  .default({ format: "markdown" })

const OpenMathDefaultModeSchema = z.enum(["interactive", "solve_only", "export"])
const OpenMathStateFilenameModeSchema = z.enum(["linux", "windows"])

const OpenMathSolveOnlyConfigSchema = z
  .object({
    max_concurrency: z.number().int().min(1).optional(),
    auto_export: z.boolean().optional(),
    export_dir: z.string().optional(),
  })
  .optional()

const OpenMathExportConfigSchema = z
  .object({
    default_dir: z.string().optional(),
    overwrite: z.boolean().optional(),
    allowed_base_dirs: z.array(z.string()).optional(),
    default_prefix: z.string().optional(),
  })
  .optional()

export const OpenMathConfigSchema = z.object({
  max_review_rounds: z.number().int().min(1).default(3),
  max_consecutive_patch_failures: z.number().int().min(1).default(2),
  artifacts: OpenMathArtifactsConfigSchema,
  state_filename_mode: OpenMathStateFilenameModeSchema.default("linux"),
  default_mode: OpenMathDefaultModeSchema.optional(),
  solve_only: OpenMathSolveOnlyConfigSchema,
  export: OpenMathExportConfigSchema,
})

export type OpenMathConfig = z.infer<typeof OpenMathConfigSchema>
