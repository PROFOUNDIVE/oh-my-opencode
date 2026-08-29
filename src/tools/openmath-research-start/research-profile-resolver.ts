import type { AgentOverrides, OpenMathConfig } from "../../config/schema"
import {
  ResearchProfileResolutionError,
  resolveResearchProfileSnapshot,
  type ResearchProfileSnapshot,
} from "../../openmath/research/profile-snapshot"
import { findBuiltinWorkflowProfile } from "../../openmath/workflow"
import {
  resolveWorkflowRoleModels,
  WorkflowRoleModelResolutionError,
} from "../../openmath/workflow/stage-runner"
import type { ResolvedAgentModel } from "../../openmath/workflow/profile-snapshot"
import type { OpencodeClient } from "../delegate-task/types"
import type { ReferenceSnapshot } from "../../openmath/references/types"

type Role = Readonly<{
  readonly agent: string
  readonly model?: string
  readonly variant?: string
}>

export async function resolveResearchProfileForTool(input: Readonly<{
  readonly config: OpenMathConfig
  readonly directory: string
  readonly research_profile: string | undefined
  readonly references: ReferenceSnapshot
  readonly client: OpencodeClient | undefined
  readonly plugin_agents: AgentOverrides | undefined
}>): Promise<ResearchProfileSnapshot> {
  const profileName = input.research_profile ?? input.config.default_research_profile
  const profile = profileName === undefined
    ? undefined
    : input.config.research_profiles?.[profileName]
  if (profileName === undefined || profile === undefined) {
    throw new ResearchProfileResolutionError(
      "PROFILE_NOT_FOUND",
      profileName,
      profileName === undefined
        ? "Research profile not found"
        : `Research profile not found: ${profileName}`,
    )
  }
  const candidate = input.config.workflow_profiles[profile.candidate_workflow_profile]
    ?? findBuiltinWorkflowProfile(
      profile.candidate_workflow_profile,
      input.config.max_review_rounds,
    )
  const roles = candidate === undefined
    ? [...profile.screening_roles, profile.tournament_role]
    : [candidate.solve, candidate.review, candidate.revise, ...profile.screening_roles, profile.tournament_role]
  const resolvedModels = await resolveMissingModels(roles, input)
  return resolveResearchProfileSnapshot({
    config: input.config,
    directory: input.directory,
    research_profile: input.research_profile,
    reference_snapshot: input.references,
    resolve_agent_model: (agent) => requiredModel(resolvedModels, agent, profileName),
  })
}

async function resolveMissingModels(
  roles: readonly Role[],
  input: Readonly<{
    readonly client: OpencodeClient | undefined
    readonly plugin_agents: AgentOverrides | undefined
  }>,
): Promise<ReadonlyMap<string, ResolvedAgentModel>> {
  const unresolved = [...new Set(
    roles.filter((role) => role.model === undefined).map((role) => role.agent),
  )]
  const entries = await Promise.all(unresolved.map(async (agent) => {
    const role = roles.find((candidate) => (
      candidate.agent === agent && candidate.model === undefined
    ))
    if (role === undefined) throw new TypeError(`Research role not found: ${agent}`)
    try {
      const resolved = await resolveWorkflowRoleModels({
        client: input.client,
        plugin_agents: input.plugin_agents,
        roles: { solve: role, review: role, revise: role },
      })
      return [agent, resolved.solve] as const
    } catch (error) {
      if (error instanceof WorkflowRoleModelResolutionError) {
        throw new ResearchProfileResolutionError("SOURCE_ERROR", undefined, error.message)
      }
      throw error
    }
  }))
  return new Map(entries)
}

function requiredModel(
  models: ReadonlyMap<string, ResolvedAgentModel>,
  agent: string,
  profile: string,
): ResolvedAgentModel {
  const model = models.get(agent)
  if (model !== undefined) return model
  throw new ResearchProfileResolutionError(
    "SOURCE_ERROR",
    profile,
    `No resolved model is available for research agent: ${agent}`,
  )
}
