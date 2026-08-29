import {
  type CampaignOperationPlanResult,
  type CampaignSchedulerResult,
  type CampaignStepDependencies,
} from "../../openmath/research/application"
import { createOpenCodeCandidateDiscoveryStepDependencies } from "../../openmath/research/candidates"
import { createPromotionDossierStepDependencies } from "../../openmath/research/dossier"
import { createOpenCodeSelectedRefinementStepDependencies } from "../../openmath/research/refinement"
import { createOpenCodeInitialScreeningStepDependencies } from "../../openmath/research/screening"
import { createOpenCodeTournamentStepDependencies } from "../../openmath/research/tournament"
import type { ResearchCampaignStateV1 } from "../../openmath/research/state"
import type { ToolContextWithMetadata } from "../delegate-task/types"
import type {
  OpenMathResearchStepDependencies,
  OpenMathResearchToolOptions,
} from "../openmath-research-shared"

type RunOperationInput = Parameters<OpenMathResearchStepDependencies["run_operation"]>[0]

export function createOpenMathResearchStepDependencies(input: Readonly<{
  readonly options: Pick<OpenMathResearchToolOptions, "directory" | "client">
  readonly context: ToolContextWithMetadata
}>): OpenMathResearchStepDependencies {
  const client = input.options.client
  if (client === undefined) {
    throw new TypeError("OpenCode client is required for research campaign execution")
  }
  const runtime = {
    directory: input.options.directory,
    client,
    ctx: input.context,
  }
  const discovery = createOpenCodeCandidateDiscoveryStepDependencies(runtime)
  const screening = createOpenCodeInitialScreeningStepDependencies(runtime)
  const tournament = createOpenCodeTournamentStepDependencies(runtime)
  const refinement = createOpenCodeSelectedRefinementStepDependencies(runtime)
  const dossier = createPromotionDossierStepDependencies({
    directory: input.options.directory,
  })
  return {
    plan_operation: (state) => planOperation(
      state,
      { discovery, screening, tournament, refinement },
    ),
    run_operation: (operation) => runOperation(
      operation,
      { discovery, screening, tournament, refinement },
    ),
    prepare_dossier: dossier.prepare_dossier,
  }
}

type OperationDependencies = Readonly<{
  readonly discovery: CampaignStepDependencies
  readonly screening: CampaignStepDependencies
  readonly tournament: CampaignStepDependencies
  readonly refinement: CampaignStepDependencies
}>

function planOperation(
  state: ResearchCampaignStateV1,
  dependencies: OperationDependencies,
): CampaignOperationPlanResult {
  switch (state.phase) {
    case "DISCOVERY":
      return dependencies.discovery.plan_operation(state)
    case "SCREENING":
      return dependencies.screening.plan_operation(state)
    case "TOURNAMENT":
      return dependencies.tournament.plan_operation(state)
    case "DEEP_REFINEMENT":
      return dependencies.refinement.plan_operation(state)
    case "PROMOTION":
      return {
        ok: false,
        error_code: "ILLEGAL_TRANSITION",
        message: "Promotion uses dossier preparation rather than a campaign operation",
      }
    default:
      return assertNever(state.phase)
  }
}

function runOperation(
  operation: RunOperationInput,
  dependencies: OperationDependencies,
): Promise<CampaignSchedulerResult> {
  switch (operation.state.phase) {
    case "DISCOVERY":
      return dependencies.discovery.run_operation(operation)
    case "SCREENING":
      return dependencies.screening.run_operation(operation)
    case "TOURNAMENT":
      return dependencies.tournament.run_operation(operation)
    case "DEEP_REFINEMENT":
      return dependencies.refinement.run_operation(operation)
    case "PROMOTION":
      return Promise.resolve({
        ok: false,
        error_code: "ILLEGAL_TRANSITION",
        message: "Promotion uses dossier preparation rather than a campaign operation",
      })
    default:
      return assertNever(operation.state.phase)
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected research campaign phase: ${String(value)}`)
}
