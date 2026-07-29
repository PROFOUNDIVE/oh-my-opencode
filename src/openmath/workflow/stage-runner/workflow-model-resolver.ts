import type { AgentOverrides } from "../../../config/schema"
import { resolveSubagentExecution } from "../../../tools/delegate-task/subagent-resolver"
import type { DelegateTaskArgs, OpencodeClient } from "../../../tools/delegate-task/types"
import { parseWorkflowModelString } from "../role-settings"

type ResolvedModel = Readonly<{ readonly providerID: string; readonly modelID: string; readonly variant?: string }>
type RoleInput = Readonly<{ readonly agent: string; readonly model?: string; readonly variant?: string }>

type WorkflowModelResolverDependencies = Readonly<{
  readonly resolveSubagent: (
    args: DelegateTaskArgs,
    context: Readonly<{ readonly client: OpencodeClient | undefined; readonly agentOverrides: AgentOverrides | undefined }>,
  ) => Promise<Readonly<{ readonly agentToUse: string; readonly categoryModel: ResolvedModel | undefined; readonly error?: string }>>
}>

const workflowModelResolverDependencies: WorkflowModelResolverDependencies = {
  resolveSubagent: async (args, context) => {
    if (!context.client) throw new WorkflowRoleModelResolutionError(args.subagent_type ?? "unknown", "OpenCode client is required for agent model resolution")
    return resolveSubagentExecution(args, {
      client: context.client,
      agentOverrides: context.agentOverrides,
    }, undefined, "deep")
  },
}

export class WorkflowRoleModelResolutionError extends Error {
  readonly name = "WorkflowRoleModelResolutionError"

  constructor(
    readonly role: string,
    message: string,
  ) {
    super(message)
  }
}

export async function resolveWorkflowRoleModels(input: Readonly<{
  readonly client: OpencodeClient | undefined
  readonly plugin_agents: AgentOverrides | undefined
  readonly roles: Readonly<{ readonly solve: RoleInput; readonly review: RoleInput; readonly revise: RoleInput }>
}>, dependencies: WorkflowModelResolverDependencies = workflowModelResolverDependencies): Promise<Readonly<{
  readonly solve: ResolvedModel
  readonly review: ResolvedModel
  readonly revise: ResolvedModel
}>> {
  return {
    solve: await resolveRoleModel("solve", input.roles.solve, input.client, input.plugin_agents, dependencies),
    review: await resolveRoleModel("review", input.roles.review, input.client, input.plugin_agents, dependencies),
    revise: await resolveRoleModel("revise", input.roles.revise, input.client, input.plugin_agents, dependencies),
  }
}

async function resolveRoleModel(
  role: string,
  input: RoleInput,
  client: OpencodeClient | undefined,
  agentOverrides: AgentOverrides | undefined,
  dependencies: WorkflowModelResolverDependencies,
): Promise<ResolvedModel> {
  if (input.model !== undefined) {
    const parsed = parseWorkflowModelString(input.model)
    if (!parsed) throw new WorkflowRoleModelResolutionError(role, "Explicit workflow model has blank provider or model segments")
    if (input.variant !== undefined && input.variant.trim().length === 0) {
      throw new WorkflowRoleModelResolutionError(role, "Explicit workflow variant must not be blank")
    }
    return input.variant === undefined ? parsed : { ...parsed, variant: input.variant }
  }
  const resolution = await dependencies.resolveSubagent({
    description: `OpenMath workflow ${role} model resolution`,
    prompt: "",
    run_in_background: false,
    load_skills: [],
    command: undefined,
    subagent_type: input.agent,
  }, { client, agentOverrides })
  if (resolution.error || !resolution.categoryModel) {
    throw new WorkflowRoleModelResolutionError(role, resolution.error ?? "No resolved model is available for this workflow role")
  }
  if (!isResolvedModel(resolution.categoryModel)) {
    throw new WorkflowRoleModelResolutionError(role, "Resolved workflow model has blank provider, model, or variant segments")
  }
  return resolution.categoryModel
}

function isResolvedModel(model: ResolvedModel): boolean {
  return model.providerID.trim().length > 0
    && model.modelID.trim().length > 0
    && !/\s/.test(model.providerID)
    && !/\s/.test(model.modelID)
    && (model.variant === undefined || model.variant.trim().length > 0)
}
