import type { OpencodeClient, ToolContextWithMetadata } from "../../../tools/delegate-task/types"
import type { CampaignStepDependencies } from "../application"
import { createCampaignDispatchRuntime } from "../scheduler"
import { planSelectedRefinement } from "./refinement-planner"
import { runSelectedRefinement, type RefinementJobRuntimeFactory } from "./run-selected-refinement"

type Infrastructure = Omit<CampaignStepDependencies, "plan_operation" | "run_operation">

export function createSelectedRefinementStepDependencies(input: Readonly<{
  readonly directory: string
  readonly storageDirectory?: string
  readonly create_job_runtime: RefinementJobRuntimeFactory
  readonly infrastructure?: Infrastructure
}>): CampaignStepDependencies {
  return {
    ...input.infrastructure,
    plan_operation: planSelectedRefinement,
    run_operation: (operation) => runSelectedRefinement(operation, input),
  }
}

export function createOpenCodeSelectedRefinementStepDependencies(input: Readonly<{
  readonly directory: string
  readonly storageDirectory?: string
  readonly client: OpencodeClient
  readonly ctx: ToolContextWithMetadata
  readonly infrastructure?: Infrastructure
}>): CampaignStepDependencies {
  return createSelectedRefinementStepDependencies({
    directory: input.directory,
    storageDirectory: input.storageDirectory ?? input.directory,
    ...(input.infrastructure === undefined ? {} : { infrastructure: input.infrastructure }),
    create_job_runtime: (callbacks) => createCampaignDispatchRuntime({ ...input, ...callbacks }),
  })
}
