import type { ToolDefinition } from "@opencode-ai/plugin/tool"
import { readdirSync } from "node:fs"

import {
  CampaignErrorEnvelopeSchema,
  CampaignSuccessEnvelopeSchema,
  type CampaignErrorEnvelope,
  type CampaignSuccessEnvelope,
} from "../application"
import { readResearchCampaignState } from "../storage"
import { getResearchCampaignDirectory } from "../storage/campaign-directory-hash"
import type { ToolContextWithMetadata } from "../../../tools/delegate-task/types"
import type {
  FactoryCrashBoundary,
  RecoverableCampaignPhase,
  createRestartableFactoryTransport,
} from "./restartable-factory-transport"

type PublicTools = Record<string, ToolDefinition>
type RestartTransport = ReturnType<typeof createRestartableFactoryTransport>

type RestartRunnerInput = Readonly<{
  readonly directory: string
  readonly context: ToolContextWithMetadata
  readonly tools: () => PublicTools
  readonly transport: RestartTransport
  readonly dependency_constructions: () => number
}>

export function createToolFactoryRestartRunner(input: RestartRunnerInput) {
  return async (
    phase: RecoverableCampaignPhase,
    boundary: FactoryCrashBoundary,
  ) => {
    const prepared = await prepareCampaign(input, phase)
    const before = input.transport.snapshot()
    const constructionsBefore = input.dependency_constructions()
    input.transport.arm({ phase, boundary })

    const crash = error(await execute(input.tools(), "openmath_research_step", {
      campaign_id: "campaign-a",
      expected_state_revision: prepared.state_revision,
      mode: "one_stage",
    }, input.context))
    const interrupted = success(await execute(input.tools(), "openmath_research_status", {
      campaign_id: "campaign-a",
    }, input.context))
    const recovered = success(await execute(input.tools(), "openmath_research_step", {
      campaign_id: "campaign-a",
      expected_state_revision: interrupted.state_revision,
      mode: "one_stage",
    }, input.context))
    const after = input.transport.snapshot()
    const state = await stored(input.directory)
    const operationJobs = state.job_attempts.filter((job) => job.prepared_at_revision > prepared.state_revision)

    return {
      phase,
      boundary,
      public_json: { crash, interrupted, recovered },
      persisted: {
        revision: state.state_revision,
        revisions: revisionNumbers(input.directory),
        operation_jobs: operationJobs.map((job) => ({
          job_id: job.job_id,
          phase: job.phase,
          child_session_id: "child_session_id" in job ? job.child_session_id : null,
          phase_revision: job.phase_revision,
        })),
        active_job_ids: state.active_job_ids,
      },
      exact_once: {
        jobs: operationJobs.length,
        child_creations: after.child_creations - before.child_creations,
        prompt_appends: after.prompt_appends - before.prompt_appends,
        completion_writes: after.completion_writes - before.completion_writes,
        external_dispatches: phaseDispatches(after, phase) - phaseDispatches(before, phase),
      },
      dependency_constructions: input.dependency_constructions() - constructionsBefore,
    }
  }
}

async function prepareCampaign(
  input: RestartRunnerInput,
  target: RecoverableCampaignPhase,
): Promise<CampaignSuccessEnvelope> {
  let current = success(await execute(input.tools(), "openmath_research_start", {
    campaign_id: "campaign-a",
    objective: { kind: "markdown", instruction: "Prove the phase A restart objective." },
  }, input.context))
  for (const phase of ["DISCOVERY", "SCREENING", "TOURNAMENT"] as const) {
    if (phase === target) break
    current = success(await execute(input.tools(), "openmath_research_step", {
      campaign_id: "campaign-a",
      expected_state_revision: current.state_revision,
      mode: "one_stage",
    }, input.context))
  }
  return current
}

async function stored(directory: string) {
  const result = await readResearchCampaignState(directory, "campaign-a")
  if (result.kind === "error") throw new TypeError(result.message)
  return result.state
}

function execute(
  tools: PublicTools,
  key: string,
  args: Record<string, unknown>,
  context: ToolContextWithMetadata,
): Promise<unknown> {
  const definition = tools[key]
  if (definition === undefined) throw new TypeError(`Missing public research tool: ${key}`)
  return definition.execute(args, context)
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

function phaseDispatches(
  snapshot: ReturnType<RestartTransport["snapshot"]>,
  phase: RecoverableCampaignPhase,
): number {
  return Number(snapshot.external_dispatches[phase] ?? 0)
}

function revisionNumbers(directory: string): readonly number[] {
  return readdirSync(getResearchCampaignDirectory(directory, "campaign-a"))
    .flatMap((name) => /^campaign\.rev-(\d{12})\.json$/.exec(name)?.[1] ?? [])
    .map(Number)
    .sort((left, right) => left - right)
}
