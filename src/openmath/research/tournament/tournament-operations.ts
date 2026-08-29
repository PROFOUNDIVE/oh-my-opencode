import type { OpencodeClient, ToolContextWithMetadata } from "../../../tools/delegate-task/types"
import type { CampaignStepDependencies } from "../application"
import { createCampaignDispatchRuntime } from "../scheduler"
import { runTournament, type TournamentJobRuntimeFactory } from "./run-tournament"
import { planTournament } from "./tournament-planner"

type Infrastructure = Omit<CampaignStepDependencies, "plan_operation" | "run_operation">

export function createTournamentStepDependencies(input: Readonly<{
  readonly directory: string
  readonly create_job_runtime: TournamentJobRuntimeFactory
  readonly infrastructure?: Infrastructure
}>): CampaignStepDependencies {
  return {
    ...input.infrastructure,
    plan_operation: planTournament,
    run_operation: (operation) => runTournament(operation, input),
  }
}

export function createOpenCodeTournamentStepDependencies(input: Readonly<{
  readonly directory: string
  readonly client: OpencodeClient
  readonly ctx: ToolContextWithMetadata
  readonly infrastructure?: Infrastructure
}>): CampaignStepDependencies {
  return createTournamentStepDependencies({
    directory: input.directory,
    ...(input.infrastructure === undefined ? {} : { infrastructure: input.infrastructure }),
    create_job_runtime: (callbacks) => createCampaignDispatchRuntime({ ...input, ...callbacks }),
  })
}
