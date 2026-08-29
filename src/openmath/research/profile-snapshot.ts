import { createHash } from "node:crypto"

import type { OpenMathConfig } from "../../config/schema/openmath"
import { resolveAllowedRoots, resolveManifestPath } from "../references/path-resolver"
import { ReferenceManifestError, type ReferenceSnapshot } from "../references/types"
import {
  resolveWorkflowProfileSnapshot,
  type ResolvedAgentModel,
  type ResolvedWorkflowProfileSnapshot,
} from "../workflow/profile-snapshot"
import { WorkflowProfileResolutionError } from "../workflow/profile-snapshot-error"
import { ReferenceSnapshotSchema, WorkflowProfileSnapshotSchema } from "../workflow/state/snapshots"
import { ResearchProfileNameSchema, type ResearchProfile } from "./profile-schema"
import {
  ResearchRoleResolutionError,
  resolveResearchPromptSnapshot,
  resolveResearchRoleSnapshot,
  type ResolvedResearchPromptSnapshot,
  type ResolvedResearchRoleSnapshot,
} from "./role-settings"

export type { ResolvedResearchPromptSnapshot, ResolvedResearchRoleSnapshot } from "./role-settings"

type CandidateWorkflowProfileSnapshot = Readonly<
  ResolvedWorkflowProfileSnapshot & { readonly snapshot_version: number }
>

export type ResearchProfileSnapshot = Readonly<{
  readonly snapshot_version: 1
  readonly name: string
  readonly candidate_workflow_profile: CandidateWorkflowProfileSnapshot
  readonly candidate_workflow_profile_hash: string
  readonly strategies: readonly Readonly<{
    readonly id: string
    readonly prompt: ResolvedResearchPromptSnapshot
  }>[]
  readonly candidates_per_strategy: number
  readonly screening_roles: readonly Readonly<ResolvedResearchRoleSnapshot & { readonly id: string }>[]
  readonly max_active_candidates: number
  readonly survivor_limit: number
  readonly tournament_role: ResolvedResearchRoleSnapshot
  readonly profile_hash: string
  readonly reference_snapshot: ReferenceSnapshot
}>

export type ResearchProfileResolutionErrorCode =
  | "PROFILE_NOT_FOUND"
  | "SOURCE_ERROR"
  | "INVALID_WORKFLOW_PROFILE"

export class ResearchProfileResolutionError extends Error {
  readonly name = "ResearchProfileResolutionError"

  constructor(
    readonly code: ResearchProfileResolutionErrorCode,
    readonly profile: string | undefined,
    detail: string,
  ) {
    super(detail)
  }
}

export type ResolveResearchProfileSnapshotInput = Readonly<{
  readonly config: OpenMathConfig
  readonly directory: string
  readonly research_profile?: string
  readonly reference_snapshot: ReferenceSnapshot
  readonly resolve_agent_model: (agent: string) => ResolvedAgentModel
}>

export function resolveResearchProfileSnapshot(
  input: ResolveResearchProfileSnapshotInput,
): ResearchProfileSnapshot {
  const selection = selectProfile(input.config, input.research_profile)
  const allowedRoots = resolveRoots(input, selection.name)
  const candidate = resolveCandidateWorkflow(input, selection, allowedRoots)
  const source = (location: string) => ({ directory: input.directory, allowed_roots: allowedRoots, location })
  let strategies: ResearchProfileSnapshot["strategies"]
  let screeningRoles: ResearchProfileSnapshot["screening_roles"]
  let tournamentRole: ResearchProfileSnapshot["tournament_role"]
  try {
    strategies = selection.profile.strategies.map((strategy) => ({
      id: strategy.id,
      prompt: resolveResearchPromptSnapshot({ prompt: strategy.prompt, ...source(`strategies.${strategy.id}`) }),
    }))
    screeningRoles = selection.profile.screening_roles.map((role) => ({
      id: role.id,
      ...resolveResearchRoleSnapshot({
        role,
        source: source(`screening_roles.${role.id}`),
        resolve_agent_model: input.resolve_agent_model,
      }),
    }))
    tournamentRole = resolveResearchRoleSnapshot({
      role: selection.profile.tournament_role,
      source: source("tournament_role"),
      resolve_agent_model: input.resolve_agent_model,
    })
  } catch (error) {
    if (error instanceof ResearchRoleResolutionError) {
      throw new ResearchProfileResolutionError("SOURCE_ERROR", selection.name, error.message)
    }
    throw error
  }
  const candidateHash = sha256(JSON.stringify(candidate))
  const core = {
    snapshot_version: 1 as const,
    name: selection.name,
    candidate_workflow_profile: candidate,
    candidate_workflow_profile_hash: candidateHash,
    strategies,
    candidates_per_strategy: selection.profile.candidates_per_strategy,
    screening_roles: screeningRoles,
    max_active_candidates: selection.profile.max_active_candidates,
    survivor_limit: selection.profile.survivor_limit,
    tournament_role: tournamentRole,
  }
  const referenceSnapshot = ReferenceSnapshotSchema.parse(input.reference_snapshot)
  const snapshot: ResearchProfileSnapshot = {
    ...core,
    profile_hash: sha256(JSON.stringify(core)),
    reference_snapshot: referenceSnapshot,
  }
  deepFreeze(snapshot)
  return snapshot
}

function selectProfile(
  config: OpenMathConfig,
  explicit: string | undefined,
): Readonly<{ readonly name: string; readonly profile: ResearchProfile }> {
  const name = explicit ?? config.default_research_profile
  if (name === undefined) {
    throw new ResearchProfileResolutionError("PROFILE_NOT_FOUND", undefined, "Research profile not found")
  }
  const parsedName = ResearchProfileNameSchema.safeParse(name)
  if (!parsedName.success) {
    throw new ResearchProfileResolutionError("PROFILE_NOT_FOUND", name, `Research profile not found: ${name}`)
  }
  const profile = config.research_profiles?.[parsedName.data]
  if (!profile) throw new ResearchProfileResolutionError("PROFILE_NOT_FOUND", name, `Research profile not found: ${name}`)
  return { name: parsedName.data, profile }
}

function resolveRoots(
  input: ResolveResearchProfileSnapshotInput,
  profile: string,
): ReturnType<typeof resolveAllowedRoots> {
  try {
    return resolveAllowedRoots({
      projectDirectory: input.directory,
      configuredRoots: input.config.workflow_allowed_roots,
    })
  } catch (error) {
    if (error instanceof ReferenceManifestError) {
      throw new ResearchProfileResolutionError("SOURCE_ERROR", profile, error.message)
    }
    throw error
  }
}

function resolveCandidateWorkflow(
  input: ResolveResearchProfileSnapshotInput,
  selection: Readonly<{ readonly name: string; readonly profile: ResearchProfile }>,
  allowedRoots: ReturnType<typeof resolveAllowedRoots>,
): CandidateWorkflowProfileSnapshot {
  try {
    const resolved = resolveWorkflowProfileSnapshot({
      config: input.config,
      profile_name: selection.profile.candidate_workflow_profile,
      resolveAgentModel: input.resolve_agent_model,
    })
    if (resolved.checkpoint !== "after_solve") {
      throw new ResearchProfileResolutionError(
        "INVALID_WORKFLOW_PROFILE",
        selection.name,
        "Candidate workflow profile must checkpoint after_solve",
      )
    }
    for (const role of [resolved.solve, resolved.review, resolved.revise]) {
      if (role.prompt.kind === "file") assertFileAllowed(role.prompt.original_uri, input.directory, allowedRoots)
    }
    const snapshot = WorkflowProfileSnapshotSchema.parse({ ...resolved, snapshot_version: 1 })
    deepFreeze(snapshot)
    return snapshot
  } catch (error) {
    if (error instanceof ResearchProfileResolutionError) throw error
    if (error instanceof WorkflowProfileResolutionError) {
      const code = error.code === "profile_not_found" ? "PROFILE_NOT_FOUND" : "SOURCE_ERROR"
      throw new ResearchProfileResolutionError(code, selection.name, error.message)
    }
    if (error instanceof ReferenceManifestError) {
      throw new ResearchProfileResolutionError("SOURCE_ERROR", selection.name, error.message)
    }
    throw error
  }
}

function assertFileAllowed(
  uri: string,
  directory: string,
  allowedRoots: ReturnType<typeof resolveAllowedRoots>,
): void {
  resolveManifestPath({ referenceManifestPath: uri, projectDirectory: directory, allowedRoots })
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

function deepFreeze(value: unknown): void {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return
  for (const child of Object.values(value)) deepFreeze(child)
  Object.freeze(value)
}
