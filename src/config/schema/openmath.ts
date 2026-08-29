import { z } from "zod"
import {
  WorkflowProfileNameSchema,
  WorkflowProfilesSchema,
} from "../../openmath/workflow/profile-schema"
import { findBuiltinWorkflowProfile } from "../../openmath/workflow/builtin-profiles"
import {
  ResearchProfileNameSchema,
  ResearchProfilesSchema,
} from "../../openmath/research/profile-schema"

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
  workflow_profiles: WorkflowProfilesSchema.default({}),
  default_workflow_profile: WorkflowProfileNameSchema.optional(),
  research_profiles: ResearchProfilesSchema.optional(),
  default_research_profile: ResearchProfileNameSchema.optional(),
  workflow_allowed_roots: z.array(z.string().refine((value) => value.trim().length > 0, {
    message: "workflow_allowed_roots entries must not be blank",
  })).min(1, {
    message: "workflow_allowed_roots must contain at least one root",
  }).default(["."]),
  state_filename_mode: OpenMathStateFilenameModeSchema.default("linux"),
  default_mode: OpenMathDefaultModeSchema.optional(),
  solve_only: OpenMathSolveOnlyConfigSchema,
  export: OpenMathExportConfigSchema,
}).superRefine((config, context) => {
  for (const [name, profile] of Object.entries(config.research_profiles ?? {})) {
    const workflowProfile = config.workflow_profiles[profile.candidate_workflow_profile]
      ?? findBuiltinWorkflowProfile(profile.candidate_workflow_profile, config.max_review_rounds)
    if (!workflowProfile) {
      context.addIssue({
        code: "custom",
        path: ["research_profiles", name, "candidate_workflow_profile"],
        message: "Candidate workflow profile must exist",
      })
    }
  }
})

export type OpenMathConfig = z.infer<typeof OpenMathConfigSchema>
