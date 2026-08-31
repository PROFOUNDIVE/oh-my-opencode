import { readdirSync } from "node:fs"

import { OpenMathConfigSchema } from "../../../config/schema"
import { readResearchCampaignState } from "../storage"
import { getResearchCampaignDirectory } from "../storage/campaign-directory-hash"
import {
  CampaignErrorEnvelopeSchema,
  CampaignSuccessEnvelopeSchema,
  type CampaignErrorEnvelope,
  type CampaignSuccessEnvelope,
} from "../application"
import { removeTemporaryCampaignDirectory, temporaryCampaignDirectory } from "../application/application-test-fixture"
import { createOpenMathResearchTools } from "../../../tools/openmath-research-tools"
import { researchToolConfig, researchToolContext } from "../../../tools/openmath-research-test-support"
import { FakeCandidateTransport } from "../candidates/candidate-discovery-test-runtime"
import {
  createFactoryStepDependencies,
  createFactoryTransports,
  type TournamentNarrative,
} from "./tool-factory-dependencies"
import { createForbiddenOperationProbe } from "./forbidden-operation-probe"
import { createRestartableFactoryTransport } from "./restartable-factory-transport"
import { createToolFactoryRestartRunner } from "./tool-factory-restart-runner"

type HarnessOptions = Readonly<{ readonly tournament: TournamentNarrative }>

export function createResearchToolFactoryHarness(options: HarnessOptions) {
  const directory = temporaryCampaignDirectory()
  const config = phaseAConfig()
  const transports = createFactoryTransports(directory, options.tournament)
  const forbidden = createForbiddenOperationProbe()
  const restart = createRestartableFactoryTransport()
  let dependencyConstructions = 0
  const context = researchToolContext("ses_PhaseAHuman", "msg_PhaseADecision")
  const tools = () => createOpenMathResearchTools({
    directory,
    openmathConfig: config,
    createStepDependencies: () => {
      dependencyConstructions += 1
      return createFactoryStepDependencies(directory, options.tournament, {
        transports,
        decorate_runtime: restart.decorate,
        forbidden_operations: forbidden.seams,
      }).dependencies
    },
    ...forbidden.seams,
  })
  const runCrashRecovery = createToolFactoryRestartRunner({
    directory,
    context,
    tools,
    transport: restart,
    dependency_constructions: () => dependencyConstructions,
  })
  return {
    directory,
    cleanup: () => removeTemporaryCampaignDirectory(directory),
    parentArtifactSentinel: FakeCandidateTransport.secret,
    runCrashRecovery,
    runToDecision: async (decision: "approve" | "reject") => {
      const checkpoint = await startAndScreen(tools, context)
      const selected = success(await tools().openmath_research_step.execute({
        campaign_id: "campaign-a",
        expected_state_revision: checkpoint.state_revision,
        mode: "one_stage",
      }, context))
      const refined = success(await tools().openmath_research_step.execute({
        campaign_id: "campaign-a",
        expected_state_revision: selected.state_revision,
        mode: "one_stage",
      }, context))
      const ready = success(await tools().openmath_research_step.execute({
        campaign_id: "campaign-a",
        expected_state_revision: refined.state_revision,
        mode: "to_checkpoint",
      }, context))
      const before = await stored(directory)
      const decisionResult = success(await tools().openmath_research_promote.execute({
        campaign_id: "campaign-a",
        expected_state_revision: ready.state_revision,
        dossier_sha256: ready.dossier?.content_sha256,
        decision,
      }, context))
      const after = await stored(directory)
      return {
        checkpoint,
        selected,
        ready,
        decision: decisionResult,
        counts: counts(transports, forbidden.counts()),
        isolation: {
          candidate_b_contains_a_sentinel: transports.candidate.requests
            .filter((request) => !request.child_title.includes("direct-01"))
            .some((request) => request.user_prompt.includes(FakeCandidateTransport.secret)),
          tournament_before_all_screens: transports.tournament.requests.length > 0
            && transports.tournament.minimumScreenCountBeforeDispatch < 2,
        },
        persisted: {
          dossier_bytes_unchanged: before.dossier?.serialized_bytes === after.dossier?.serialized_bytes,
          revisions: revisionNumbers(directory),
          merge_candidate: after.candidates.find((candidate) => candidate.candidate_id === "merged-01") === undefined
            ? undefined
            : {
                candidate_id: "merged-01",
                parent_candidate_ids: after.candidates.find((candidate) => candidate.candidate_id === "merged-01")?.parent_candidate_ids,
                artifact: JSON.stringify(after.candidates.find((candidate) => candidate.candidate_id === "merged-01")?.artifact),
              },
        },
      }
    },
    runNeedsHumanAmendResume: async () => {
      const checkpoint = await startAndScreen(tools, context)
      const paused = success(await tools().openmath_research_step.execute({
        campaign_id: "campaign-a", expected_state_revision: checkpoint.state_revision,
      }, context))
      const stepWithoutAmendment = error(await tools().openmath_research_step.execute({
        campaign_id: "campaign-a", expected_state_revision: paused.state_revision,
      }, context))
      const amended = success(await tools().openmath_research_amend.execute({
        campaign_id: "campaign-a",
        expected_state_revision: paused.state_revision,
        operation: "add",
        kind: "required_check",
        scope: "next_tournament",
        content: "Resolve the categorical selection ambiguity.",
      }, context))
      const resumed = success(await tools().openmath_research_step.execute({
        campaign_id: "campaign-a", expected_state_revision: amended.state_revision,
      }, context))
      return { paused, step_without_amendment: stepWithoutAmendment, amended, resumed, tournament_dispatches: transports.tournament.requests.length }
    },
  }
}

async function startAndScreen(
  tools: () => ReturnType<typeof createOpenMathResearchTools>,
  context: ReturnType<typeof researchToolContext>,
): Promise<CampaignSuccessEnvelope> {
  const started = success(await tools().openmath_research_start.execute({
    campaign_id: "campaign-a",
    objective: { kind: "markdown", instruction: "Prove the phase A objective." },
  }, context))
  success(await tools().openmath_research_status.execute({ campaign_id: "campaign-a" }, context))
  return success(await tools().openmath_research_step.execute({
    campaign_id: "campaign-a",
    expected_state_revision: started.state_revision,
    mode: "to_checkpoint",
  }, context))
}

function phaseAConfig() {
  const base = researchToolConfig()
  const profile = base.research_profiles?.["phase-a"]
  if (profile === undefined) throw new TypeError("Phase A test profile is unavailable")
  return OpenMathConfigSchema.parse({
    ...base,
    research_profiles: { "phase-a": { ...profile, survivor_limit: 2, max_active_candidates: 2 } },
  })
}

async function stored(directory: string) {
  const result = await readResearchCampaignState(directory, "campaign-a")
  if (result.kind === "error") throw new TypeError(result.message)
  return result.state
}

function success(value: unknown): CampaignSuccessEnvelope {
  const decoded: unknown = JSON.parse(String(value))
  const parsed = CampaignSuccessEnvelopeSchema.safeParse(decoded)
  if (parsed.success) return parsed.data
  const failure = CampaignErrorEnvelopeSchema.safeParse(decoded)
  if (failure.success) throw new TypeError(`${failure.data.error_code}: ${failure.data.message}`)
  return CampaignSuccessEnvelopeSchema.parse(decoded)
}

function error(value: unknown): CampaignErrorEnvelope {
  return CampaignErrorEnvelopeSchema.parse(JSON.parse(String(value)))
}

function revisionNumbers(directory: string): readonly number[] {
  return readdirSync(getResearchCampaignDirectory(directory, "campaign-a"))
    .flatMap((name) => /^campaign\.rev-(\d{12})\.json$/.exec(name)?.[1] ?? [])
    .map(Number)
    .sort((left, right) => left - right)
}

function counts(
  transports: ReturnType<typeof createFactoryStepDependencies>["transports"],
  forbiddenOperations: ReturnType<ReturnType<typeof createForbiddenOperationProbe>["counts"]>,
) {
  return {
    candidates: transports.candidate.requests.length,
    screens: transports.screening.requests.length,
    tournaments: transports.tournament.requests.length,
    refinements: transports.refinement.requests.length,
    canonical_writes: forbiddenOperations.canonical_export,
    continuation_tasks: forbiddenOperations.continuation_schedule,
    forbidden_operations: forbiddenOperations,
  }
}
