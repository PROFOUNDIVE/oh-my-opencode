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

export const ResearchProfileSchema = z.object({
  candidate_workflow_profile: WorkflowProfileNameSchema,
  strategies: z.array(ResearchStrategySchema).min(2).max(8).readonly(),
  candidates_per_strategy: z.number().int().min(1).max(4),
  screening_roles: z.array(ResearchScreeningRoleSchema).min(1).max(4).readonly(),
  max_active_candidates: z.number().int().min(1).max(32),
  survivor_limit: z.number().int().min(1).max(32),
  tournament_role: ResearchRoleSettingsSchema,
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
export type ResearchProfiles = z.infer<typeof ResearchProfilesSchema>
export type ResearchProfileName = z.infer<typeof ResearchProfileNameSchema>
