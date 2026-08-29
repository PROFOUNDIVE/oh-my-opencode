import type {
  CampaignOperationPlanResult,
  CampaignSchedulerResult,
  CampaignStepDependencies,
} from "../application"
import { createCandidateDiscoveryStepDependencies } from "../candidates/candidate-discovery-operations"
import { FakeCandidateTransport } from "../candidates/candidate-discovery-test-runtime"
import { createPromotionDossierStepDependencies } from "../dossier"
import { createSelectedRefinementStepDependencies } from "../refinement"
import {
  FakeRefinementTransport,
  reviewOutput,
} from "../refinement/refinement-test-support"
import { createInitialScreeningStepDependencies } from "../screening/screening-operations"
import { FakeScreeningTransport } from "../screening/screening-test-runtime"
import type { ResearchCampaignStateV1 } from "../state"
import { createTournamentStepDependencies } from "../tournament/tournament-operations"
import { FakeTournamentTransport, keepOutput } from "../tournament/tournament-operation.test-support"
import type { OpenMathResearchStepDependencies } from "../../../tools/openmath-research-shared"
import type { CampaignJobRuntime } from "../scheduler"
import type { ForbiddenOperationSeams } from "./forbidden-operation-probe"
import type { RecoverableCampaignPhase } from "./restartable-factory-transport"

export type TournamentNarrative = "KEEP" | "MERGE_IDEA" | "NEEDS_HUMAN_THEN_KEEP"

export type FactoryTransports = Readonly<{
  readonly candidate: FakeCandidateTransport
  readonly screening: FakeScreeningTransport
  readonly tournament: FakeTournamentTransport
  readonly refinement: FakeRefinementTransport
}>

export function createFactoryTransports(
  directory: string,
  narrative: TournamentNarrative,
): FactoryTransports {
  return {
    candidate: new FakeCandidateTransport(false, directory),
    screening: new FakeScreeningTransport(),
    tournament: new FakeTournamentTransport(directory, tournamentOutputs(narrative)),
    refinement: new FakeRefinementTransport(
      narrative === "MERGE_IDEA"
        ? ["# merged proof", reviewOutput("[CORRECT]")]
        : [reviewOutput("[CORRECT]")],
    ),
  }
}

type RunOperationInput = Parameters<CampaignStepDependencies["run_operation"]>[0]

type FactoryDependencyOptions = Readonly<{
  readonly transports?: FactoryTransports
  readonly decorate_runtime?: (
    phase: RecoverableCampaignPhase,
    runtime: CampaignJobRuntime,
  ) => CampaignJobRuntime
  readonly forbidden_operations?: ForbiddenOperationSeams
}>

export function createFactoryStepDependencies(
  directory: string,
  narrative: TournamentNarrative,
  options: FactoryDependencyOptions = {},
): Readonly<{
  readonly dependencies: OpenMathResearchStepDependencies
  readonly transports: FactoryTransports
}> {
  const shared = options.transports ?? createFactoryTransports(directory, narrative)
  const { candidate, screening, tournament, refinement } = shared
  const operations = {
    discovery: createCandidateDiscoveryStepDependencies({
      directory,
      create_job_runtime: (callbacks) => decorate(options, "DISCOVERY", candidate.runtime(callbacks)),
    }),
    screening: createInitialScreeningStepDependencies({
      directory,
      create_job_runtime: (callbacks) => decorate(options, "SCREENING", screening.runtime(callbacks)),
    }),
    tournament: createTournamentStepDependencies({
      directory,
      create_job_runtime: (callbacks) => decorate(options, "TOURNAMENT", tournament.runtime(callbacks)),
    }),
    refinement: createSelectedRefinementStepDependencies({
      directory,
      create_job_runtime: (callbacks) => decorate(options, "DEEP_REFINEMENT", refinement.runtime(callbacks)),
    }),
  }
  return {
    transports: { candidate, screening, tournament, refinement },
    dependencies: {
      plan_operation: (state) => plan(state, operations),
      run_operation: (operation) => run(operation, operations),
      prepare_dossier: createPromotionDossierStepDependencies({ directory }).prepare_dossier,
      ...options.forbidden_operations,
    },
  }
}

function decorate(
  options: FactoryDependencyOptions,
  phase: RecoverableCampaignPhase,
  runtime: CampaignJobRuntime,
): CampaignJobRuntime {
  return options.decorate_runtime?.(phase, runtime) ?? runtime
}

type Operations = Readonly<{
  readonly discovery: CampaignStepDependencies
  readonly screening: CampaignStepDependencies
  readonly tournament: CampaignStepDependencies
  readonly refinement: CampaignStepDependencies
}>

function plan(
  state: ResearchCampaignStateV1,
  operations: Operations,
): CampaignOperationPlanResult {
  switch (state.phase) {
    case "DISCOVERY": return operations.discovery.plan_operation(state)
    case "SCREENING": return state.status === "AWAITING_HUMAN"
      ? operations.tournament.plan_operation(state)
      : operations.screening.plan_operation(state)
    case "TOURNAMENT": return operations.tournament.plan_operation(state)
    case "DEEP_REFINEMENT": return operations.refinement.plan_operation(state)
    case "PROMOTION": return { ok: false, error_code: "ILLEGAL_TRANSITION", message: "Dossier preparation owns promotion" }
    default: return assertNever(state.phase)
  }
}

function run(operation: RunOperationInput, operations: Operations): Promise<CampaignSchedulerResult> {
  switch (operation.state.phase) {
    case "DISCOVERY": return operations.discovery.run_operation(operation)
    case "SCREENING": return operation.state.status === "AWAITING_HUMAN"
      ? operations.tournament.run_operation(operation)
      : operations.screening.run_operation(operation)
    case "TOURNAMENT": return operations.tournament.run_operation(operation)
    case "DEEP_REFINEMENT": return operations.refinement.run_operation(operation)
    case "PROMOTION": return Promise.resolve({ ok: false, error_code: "ILLEGAL_TRANSITION", message: "Dossier preparation owns promotion" })
    default: return assertNever(operation.state.phase)
  }
}

function tournamentOutputs(narrative: TournamentNarrative): readonly string[] {
  switch (narrative) {
    case "KEEP": return [keepOutput()]
    case "MERGE_IDEA": return [JSON.stringify({
      kind: "DECIDED",
      actions: [
        { label: "entry-001", action: "MERGE_IDEA" },
        { label: "entry-002", action: "MERGE_IDEA" },
      ],
      synthesis_brief: "Synthesize the surviving ideas without copying parent artifacts.",
    })]
    case "NEEDS_HUMAN_THEN_KEEP": return [JSON.stringify({ kind: "NEEDS_HUMAN" }), keepOutput()]
    default: return assertNever(narrative)
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected factory E2E variant: ${String(value)}`)
}
