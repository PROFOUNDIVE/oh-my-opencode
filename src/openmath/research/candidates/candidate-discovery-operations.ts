import type { OpencodeClient, ToolContextWithMetadata } from "../../../tools/delegate-task/types"
import type { CampaignStepDependencies } from "../application"
import { createCampaignDispatchRuntime } from "../scheduler"
import { planCandidateDiscovery } from "./candidate-planner"
import { runCandidateDiscovery, type CandidateJobRuntimeFactory } from "./run-candidate-discovery"

type CampaignInfrastructureDependencies = Omit<CampaignStepDependencies, "plan_operation" | "run_operation">

export function createCandidateDiscoveryStepDependencies(input: Readonly<{
  readonly directory: string
  readonly create_job_runtime: CandidateJobRuntimeFactory
  readonly infrastructure?: CampaignInfrastructureDependencies
}>): CampaignStepDependencies {
  return {
    ...input.infrastructure,
    plan_operation: planCandidateDiscovery,
    run_operation: (operation) => runCandidateDiscovery(operation, input),
  }
}

export function createOpenCodeCandidateDiscoveryStepDependencies(input: Readonly<{
  readonly directory: string
  readonly client: OpencodeClient
  readonly ctx: ToolContextWithMetadata
  readonly infrastructure?: CampaignInfrastructureDependencies
}>): CampaignStepDependencies {
  return createCandidateDiscoveryStepDependencies({
    directory: input.directory,
    ...(input.infrastructure === undefined ? {} : { infrastructure: input.infrastructure }),
    create_job_runtime: (callbacks) => createCampaignDispatchRuntime({
      client: input.client,
      directory: input.directory,
      ctx: input.ctx,
      ...callbacks,
    }),
  })
}
