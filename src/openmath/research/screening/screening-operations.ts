import type { OpencodeClient, ToolContextWithMetadata } from "../../../tools/delegate-task/types"
import type { CampaignStepDependencies } from "../application"
import { createCampaignDispatchRuntime } from "../scheduler"
import { runInitialScreening, type ScreeningJobRuntimeFactory } from "./run-initial-screening"
import { planInitialScreening } from "./screening-planner"

type Infrastructure = Omit<CampaignStepDependencies, "plan_operation" | "run_operation">

export function createInitialScreeningStepDependencies(input: Readonly<{
  readonly directory: string
  readonly create_job_runtime: ScreeningJobRuntimeFactory
  readonly infrastructure?: Infrastructure
}>): CampaignStepDependencies {
  return {
    ...input.infrastructure,
    plan_operation: planInitialScreening,
    run_operation: (operation) => runInitialScreening(operation, input),
  }
}

export function createOpenCodeInitialScreeningStepDependencies(input: Readonly<{
  readonly directory: string
  readonly client: OpencodeClient
  readonly ctx: ToolContextWithMetadata
  readonly infrastructure?: Infrastructure
}>): CampaignStepDependencies {
  return createInitialScreeningStepDependencies({
    directory: input.directory,
    ...(input.infrastructure === undefined ? {} : { infrastructure: input.infrastructure }),
    create_job_runtime: (callbacks) => createCampaignDispatchRuntime({ ...input, ...callbacks }),
  })
}
