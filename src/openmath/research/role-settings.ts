import { createHash } from "node:crypto"
import { z } from "zod"

import { readResolvedReplacementPrompt, ReplacementPromptDiagnostic } from "../../agents/builtin-agents/replacement-prompt-resolver"
import { resolveManifestPath, type resolveAllowedRoots } from "../references/path-resolver"
import { ReferenceManifestError } from "../references/types"
import type { ResolvedAgentModel } from "../workflow/profile-snapshot"
import { PromptSourceSchema } from "../workflow/prompt-source"
import { parseWorkflowModelString, WorkflowModelStringSchema } from "../workflow/role-settings"
import type { ResearchCertificationProfile } from "./profile-schema"

const NonBlankStringSchema = z.string().refine((value) => value.trim().length > 0, {
  message: "Value must not be blank",
})

const [, InlinePromptSourceSchema, FilePromptSourceSchema] = PromptSourceSchema.options

export const ResearchPromptSourceSchema = z.discriminatedUnion("kind", [
  InlinePromptSourceSchema,
  FilePromptSourceSchema,
]).readonly()

export const ResearchRoleSettingsShape = {
  agent: NonBlankStringSchema,
  model: WorkflowModelStringSchema.optional(),
  variant: NonBlankStringSchema.optional(),
  prompt: ResearchPromptSourceSchema,
} as const

export const ResearchRoleSettingsSchema = z.object(ResearchRoleSettingsShape).strict().superRefine((role, context) => {
  addVariantModelIssue(role, context)
}).readonly()

export function addVariantModelIssue(
  role: Readonly<{ readonly model?: string; readonly variant?: string }>,
  context: z.RefinementCtx,
): void {
  if (role.variant !== undefined && role.model === undefined) {
    context.addIssue({
      code: "custom",
      path: ["variant"],
      message: "variant requires an explicit model",
    })
  }
}

export type ResearchPromptSource = z.infer<typeof ResearchPromptSourceSchema>
export type ResearchRoleSettings = z.infer<typeof ResearchRoleSettingsSchema>

export type ResolvedResearchPromptSnapshot =
  | Readonly<{ readonly kind: "inline"; readonly content: string; readonly content_hash: string }>
  | Readonly<{
      readonly kind: "file"
      readonly original_uri: string
      readonly base_dir: string
      readonly resolved_path: string
      readonly canonical_path: string
      readonly content: string
      readonly content_hash: string
    }>

export type ResolvedResearchRoleSnapshot = Readonly<{
  readonly agent: string
  readonly model: ResolvedAgentModel
  readonly prompt: ResolvedResearchPromptSnapshot
}>

export type ResolvedResearchCertificationSnapshot = Readonly<{
  readonly schema_version: 1
  readonly extraction_role: ResolvedResearchRoleSnapshot
  readonly coverage_role: ResolvedResearchRoleSnapshot
  readonly counterexample_role: ResolvedResearchRoleSnapshot
  readonly witness_role: ResolvedResearchRoleSnapshot
  readonly max_obligations: number
  readonly max_coverage_rounds: number
  readonly max_coverage_findings: number
  readonly allowed_attack_modes: ResearchCertificationProfile["allowed_attack_modes"]
  readonly max_attacks_per_obligation: number
  readonly max_active_certification_jobs: number
  readonly certification_profile_hash: string
}>

export class ResearchRoleResolutionError extends Error {
  readonly name = "ResearchRoleResolutionError"
}

type ResearchSourceResolutionInput = Readonly<{
  readonly directory: string
  readonly allowed_roots: ReturnType<typeof resolveAllowedRoots>
  readonly location: string
}>

export function resolveResearchRoleSnapshot(input: Readonly<{
  readonly role: ResearchRoleSettings
  readonly source: ResearchSourceResolutionInput
  readonly resolve_agent_model: (agent: string) => ResolvedAgentModel
}>): ResolvedResearchRoleSnapshot {
  const parsed = input.role.model === undefined ? undefined : parseWorkflowModelString(input.role.model)
  if (input.role.model !== undefined && parsed === undefined) {
    throw new ResearchRoleResolutionError(`Invalid model at ${input.source.location}`)
  }
  const model = parsed === undefined
    ? input.resolve_agent_model(input.role.agent)
    : input.role.variant === undefined ? parsed : { ...parsed, variant: input.role.variant }
  return {
    agent: input.role.agent,
    model: { ...model },
    prompt: resolveResearchPromptSnapshot({ prompt: input.role.prompt, ...input.source }),
  }
}

export function resolveResearchCertificationSnapshot(input: Readonly<{
  readonly certification: ResearchCertificationProfile
  readonly source: Omit<ResearchSourceResolutionInput, "location">
  readonly resolve_agent_model: (agent: string) => ResolvedAgentModel
}>): ResolvedResearchCertificationSnapshot {
  const resolveRole = (role: ResearchRoleSettings, location: string) => resolveResearchRoleSnapshot({
    role,
    source: { ...input.source, location },
    resolve_agent_model: input.resolve_agent_model,
  })
  const certification = input.certification
  const core = {
    schema_version: certification.schema_version,
    extraction_role: resolveRole(certification.extraction_role, "certification.extraction_role"),
    coverage_role: resolveRole(certification.coverage_role, "certification.coverage_role"),
    counterexample_role: resolveRole(certification.counterexample_role, "certification.counterexample_role"),
    witness_role: resolveRole(certification.witness_role, "certification.witness_role"),
    max_obligations: certification.max_obligations,
    max_coverage_rounds: certification.max_coverage_rounds,
    max_coverage_findings: certification.max_coverage_findings,
    allowed_attack_modes: certification.allowed_attack_modes,
    max_attacks_per_obligation: certification.max_attacks_per_obligation,
    max_active_certification_jobs: certification.max_active_certification_jobs,
  }
  return { ...core, certification_profile_hash: sha256(JSON.stringify(core)) }
}

export function resolveResearchPromptSnapshot(input: Readonly<{
  readonly prompt: ResearchPromptSource
} & ResearchSourceResolutionInput>): ResolvedResearchPromptSnapshot {
  switch (input.prompt.kind) {
    case "inline":
      return {
        kind: "inline",
        content: input.prompt.content,
        content_hash: sha256(input.prompt.content),
      }
    case "file":
      try {
        const resolved = resolveManifestPath({
          referenceManifestPath: input.prompt.uri,
          projectDirectory: input.directory,
          allowedRoots: input.allowed_roots,
        })
        const prompt = readResolvedReplacementPrompt(resolved)
        return {
          kind: "file",
          original_uri: prompt.uri,
          base_dir: input.directory,
          resolved_path: prompt.path,
          canonical_path: prompt.canonicalPath,
          content: prompt.content,
          content_hash: prompt.sha256,
        }
      } catch (error) {
        if (error instanceof ReferenceManifestError || error instanceof ReplacementPromptDiagnostic) {
          throw new ResearchRoleResolutionError(`${input.location}: ${error.message}`)
        }
        throw error
      }
    default:
      return assertNever(input.prompt)
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected research prompt source: ${String(value)}`)
}
