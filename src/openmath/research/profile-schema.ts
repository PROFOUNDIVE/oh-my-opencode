import { z } from "zod"

import { WorkflowProfileNameSchema } from "../workflow/profile-schema"
import {
  addVariantModelIssue,
  ResearchPromptSourceSchema,
  ResearchRoleSettingsShape,
  ResearchRoleSettingsSchema,
} from "./role-settings"

const StableIdSchema = z.string().regex(/^[a-z][a-z0-9-]*$/, {
  message: "IDs must use lowercase letters, numbers, and hyphens",
})

export const ResearchProfileNameSchema = StableIdSchema.brand<"ResearchProfileName">()
export const ResearchStrategyIdSchema = StableIdSchema.brand<"ResearchStrategyId">()
export const ResearchScreeningRoleIdSchema = StableIdSchema.brand<"ResearchScreeningRoleId">()

export const ResearchCertificationAttackModeSchema = z.enum([
  "EDGE_CASE",
  "FINITE_SEARCH",
  "DEGENERATE_CASE",
  "ASSUMPTION_REMOVAL",
  "PARAMETER_BOUNDARY",
  "CONSTRUCTION_SEARCH",
  "COMPUTATIONAL_FALSIFICATION",
])

const ResearchStrategySchema = z.object({
  id: ResearchStrategyIdSchema,
  prompt: ResearchPromptSourceSchema,
}).strict().readonly()

const ResearchScreeningRoleSchema = z.object({
  ...ResearchRoleSettingsShape,
  id: ResearchScreeningRoleIdSchema,
}).strict().superRefine((role, context) => {
  addVariantModelIssue(role, context)
}).readonly()

export const ResearchCertificationProfileSchema = z.object({
  schema_version: z.literal(1),
  extraction_role: ResearchRoleSettingsSchema,
  coverage_role: ResearchRoleSettingsSchema,
  counterexample_role: ResearchRoleSettingsSchema,
  witness_role: ResearchRoleSettingsSchema,
  max_obligations: z.number().int().min(1).max(256),
  max_coverage_rounds: z.number().int().min(1).max(5),
  max_coverage_findings: z.number().int().min(1).max(256),
  allowed_attack_modes: z.array(ResearchCertificationAttackModeSchema).min(1).max(7).readonly(),
  max_attacks_per_obligation: z.number().int().min(1).max(7),
  max_active_certification_jobs: z.number().int().min(1).max(16),
}).strict().superRefine((certification, context) => {
  addCertificationAttackBoundIssues(certification, context)
}).readonly()

export function addCertificationAttackBoundIssues(
  certification: Readonly<{
    readonly allowed_attack_modes: readonly string[]
    readonly max_attacks_per_obligation: number
  }>,
  context: z.RefinementCtx,
): void {
  const modes = new Set<string>()
  for (const [index, mode] of certification.allowed_attack_modes.entries()) {
    if (modes.has(mode)) {
      context.addIssue({ code: "custom", path: ["allowed_attack_modes", index], message: "Attack modes must be unique" })
    }
    modes.add(mode)
  }
  if (certification.max_attacks_per_obligation > modes.size) {
    context.addIssue({
      code: "custom",
      path: ["max_attacks_per_obligation"],
      message: "max_attacks_per_obligation must not exceed the unique configured attack mode count",
    })
  }
}

export const ResearchProfileSchema = z.object({
  candidate_workflow_profile: WorkflowProfileNameSchema,
  strategies: z.array(ResearchStrategySchema).min(2).max(8).readonly(),
  candidates_per_strategy: z.number().int().min(1).max(4),
  screening_roles: z.array(ResearchScreeningRoleSchema).min(1).max(4).readonly(),
  max_active_candidates: z.number().int().min(1).max(32),
  survivor_limit: z.number().int().min(1).max(32),
  tournament_role: ResearchRoleSettingsSchema,
  certification: ResearchCertificationProfileSchema.optional(),
}).strict().superRefine((profile, context) => {
  addDuplicateIssues(profile.strategies, "strategies", context)
  addDuplicateIssues(profile.screening_roles, "screening_roles", context)

  const totalCandidates = profile.strategies.length * profile.candidates_per_strategy
  if (totalCandidates > 32) {
    context.addIssue({
      code: "custom",
      path: ["candidates_per_strategy"],
      message: "Maximum total candidates is 32",
    })
  }
  if (profile.max_active_candidates > totalCandidates) {
    context.addIssue({
      code: "custom",
      path: ["max_active_candidates"],
      message: "max_active_candidates must not exceed total candidates",
    })
  }
  if (profile.survivor_limit > totalCandidates) {
    context.addIssue({
      code: "custom",
      path: ["survivor_limit"],
      message: "survivor_limit must not exceed total candidates",
    })
  }
}).readonly()

export const ResearchProfilesSchema = z.record(
  z.string(),
  ResearchProfileSchema,
).superRefine((profiles, context) => {
  for (const name of Object.keys(profiles)) {
    if (!ResearchProfileNameSchema.safeParse(name).success) {
      context.addIssue({
        code: "custom",
        path: [name],
        message: "Research profile names must use lowercase letters, numbers, and hyphens",
      })
    }
  }
}).readonly()

function addDuplicateIssues(
  values: readonly { readonly id: string }[],
  field: "strategies" | "screening_roles",
  context: z.RefinementCtx,
): void {
  const ids = new Set<string>()
  for (const [index, value] of values.entries()) {
    if (ids.has(value.id)) {
      context.addIssue({
        code: "custom",
        path: [field, index, "id"],
        message: "IDs must be unique",
      })
    }
    ids.add(value.id)
  }
}

export type ResearchProfile = z.infer<typeof ResearchProfileSchema>
export type ResearchCertificationProfile = z.infer<typeof ResearchCertificationProfileSchema>
export type ResearchProfiles = z.infer<typeof ResearchProfilesSchema>
export type ResearchProfileName = z.infer<typeof ResearchProfileNameSchema>
