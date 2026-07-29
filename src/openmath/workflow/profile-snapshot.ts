import type { OpenMathConfig } from "../../config/schema/openmath"
import { WorkflowProfileResolutionError } from "./profile-snapshot-error"
import { findBuiltinWorkflowProfile, legacyWorkflowProfileName } from "./builtin-profiles"
import { getWorkflowFilePromptProvenance, type PromptSource } from "./prompt-source"
import type { WorkflowProfile } from "./profile-schema"
import { parseWorkflowModelString, type WorkflowRoleSettings } from "./role-settings"

export type ResolvedAgentModel = {
  readonly providerID: string
  readonly modelID: string
  readonly variant?: string
}

export type ResolvedPromptSource =
  | Readonly<{ readonly kind: "builtin" }>
  | Readonly<{ readonly kind: "inline"; readonly content: string }>
  | Readonly<{
      readonly kind: "file"
      readonly original_uri: string
      readonly base_dir: string
      readonly resolved_path: string
      readonly canonical_path: string
      readonly content: string
      readonly content_hash: string
    }>

export type ResolvedWorkflowRoleSnapshot = Readonly<{
  readonly agent: string
  readonly model: ResolvedAgentModel
  readonly prompt: ResolvedPromptSource
  readonly output_adapter: WorkflowRoleSettings["output_adapter"]
}>

export type ResolvedWorkflowProfileSnapshot = Readonly<{
  readonly name: string
  readonly solve: ResolvedWorkflowRoleSnapshot
  readonly review: ResolvedWorkflowRoleSnapshot
  readonly revise: ResolvedWorkflowRoleSnapshot
  readonly min_review_rounds: number
  readonly max_review_rounds: number
  readonly required_consecutive_passes: number
  readonly checkpoint: WorkflowProfile["checkpoint"]
}>

export type ResolveWorkflowProfileSnapshotInput = {
  readonly config: OpenMathConfig
  readonly resolveAgentModel: (agent: string) => ResolvedAgentModel
  readonly profile_name?: string
}

export function resolveWorkflowProfileSnapshot(
  input: ResolveWorkflowProfileSnapshotInput,
): ResolvedWorkflowProfileSnapshot {
  const name = input.profile_name
    ?? input.config.default_workflow_profile
    ?? legacyWorkflowProfileName(input.config.artifacts.format)
  const profile = input.config.workflow_profiles[name]
    ?? findBuiltinWorkflowProfile(name, input.config.max_review_rounds)
  if (!profile) throw new WorkflowProfileResolutionError("profile_not_found", name)

  return Object.freeze({
    name,
    solve: resolveRoleSnapshot(profile.solve, input.resolveAgentModel, name, "solve"),
    review: resolveRoleSnapshot(profile.review, input.resolveAgentModel, name, "review"),
    revise: resolveRoleSnapshot(profile.revise, input.resolveAgentModel, name, "revise"),
    min_review_rounds: profile.min_review_rounds,
    max_review_rounds: profile.max_review_rounds,
    required_consecutive_passes: profile.required_consecutive_passes,
    checkpoint: profile.checkpoint,
  })
}

function resolveRoleSnapshot(
  role: WorkflowRoleSettings,
  resolveAgentModel: (agent: string) => ResolvedAgentModel,
  profileName: string,
  stage: "solve" | "review" | "revise",
): ResolvedWorkflowRoleSnapshot {
  const model = role.model === undefined
    ? resolveAgentModel(role.agent)
    : parseExplicitRoleModel(role.model, role.variant, profileName, stage)
  return Object.freeze({
    agent: role.agent,
    model: Object.freeze({ ...model }),
    prompt: resolvePromptSnapshot(role, profileName, stage),
    output_adapter: role.output_adapter,
  })
}

function parseExplicitRoleModel(
  model: string,
  variant: string | undefined,
  profileName: string,
  stage: "solve" | "review" | "revise",
): ResolvedAgentModel {
  const resolved = parseWorkflowModelString(model)
  if (!resolved) {
    throw new WorkflowProfileResolutionError("invalid_explicit_model", profileName, stage)
  }
  return variant === undefined ? resolved : { ...resolved, variant }
}

function resolvePromptSnapshot(
  role: WorkflowRoleSettings,
  profileName: string,
  stage: "solve" | "review" | "revise",
): ResolvedPromptSource {
  const source = role.prompt
  switch (source.kind) {
    case "builtin":
      return Object.freeze({ kind: "builtin" })
    case "inline":
      return Object.freeze({ kind: "inline", content: source.content })
    case "file":
      return resolveFilePromptSnapshot(role, source, profileName, stage)
  }
}

function resolveFilePromptSnapshot(
  role: WorkflowRoleSettings,
  source: Extract<PromptSource, { kind: "file" }>,
  profileName: string,
  stage: "solve" | "review" | "revise",
): ResolvedPromptSource {
  const provenance = getWorkflowFilePromptProvenance(role)
  if (!provenance) throw new WorkflowProfileResolutionError("missing_prompt_provenance", profileName, stage)
  if (provenance.original_uri !== source.uri) {
    throw new WorkflowProfileResolutionError("stale_prompt_provenance", profileName, stage)
  }
  return Object.freeze({ kind: "file", ...provenance })
}
