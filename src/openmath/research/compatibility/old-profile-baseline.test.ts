import { afterEach, describe, expect, test } from "bun:test"

import {
  CampaignErrorEnvelopeSchema,
  CampaignSuccessEnvelopeSchema,
  stepResearchCampaign,
} from "../application"
import {
  removeTemporaryCampaignDirectory,
  temporaryCampaignDirectory,
} from "../application/application-test-fixture"
import { buildPromotionDossier } from "../dossier/build-promotion-dossier"
import { createPromotionDossierStepDependencies } from "../dossier/promotion-dossier-step"
import { createPassedCampaign } from "../dossier/dossier-test-support"
import { PromotionDossierV1Schema } from "../dossier/promotion-dossier-schema"
import { ResearchCampaignStateV1Schema } from "../state"
import { startResearchCampaignState } from "../storage"
import { preparedJob } from "../transitions/operation-test-fixture"
import { emptyDiscoveryState, strategyCandidate } from "../transitions/transition-test-fixture"
import { sha256 } from "../../workflow/stage-runner/sha256"
import { OldProfileResponseSha256 } from "./old-profile-baseline.fixture"
import { createOpenMathResearchAbortTool } from "../../../tools/openmath-research-abort"
import { createOpenMathResearchAmendTool } from "../../../tools/openmath-research-amend"
import { createOpenMathResearchPromoteTool } from "../../../tools/openmath-research-promote"
import { createOpenMathResearchStartTool } from "../../../tools/openmath-research-start"
import { createOpenMathResearchStatusTool } from "../../../tools/openmath-research-status"
import { createOpenMathResearchStepTool } from "../../../tools/openmath-research-step"
import { createOpenMathResearchTools } from "../../../tools/openmath-research-tools"
import { researchToolConfig, researchToolContext } from "../../../tools/openmath-research-test-support"
import { createOpenMathWorkflowTools } from "../../../tools/openmath-workflow-tools"
import { OpenMathConfigSchema } from "../../../config/schema"

const cleanupDirectories: string[] = []

afterEach(() => {
  for (const directory of cleanupDirectories.splice(0)) removeTemporaryCampaignDirectory(directory)
})

describe("old-profile Phase-A public baseline", () => {
  test("serializes representative start status step amend promote abort responses", async () => {
    // given
    const context = researchToolContext("ses_compat", "msg_compat")
    const directory = useTemporaryDirectory()
    const start = createOpenMathResearchStartTool({ directory, openmathConfig: researchToolConfig() })
    const status = createOpenMathResearchStatusTool({ directory })
    const started = await start.execute({ campaign_id: "campaign-compat-start", objective: { kind: "markdown", instruction: "Prove it." } }, context)
    const statusResult = await status.execute({ campaign_id: "campaign-compat-start" }, context)

    const state = emptyDiscoveryState()
    await startResearchCampaignState({ directory, state })
    const candidate = strategyCandidate(false)
    const step = createOpenMathResearchStepTool({
      directory,
      createStepDependencies: () => ({
        plan_operation: () => ({ ok: true, plan: {
          candidates: [candidate],
          job_attempts: [preparedJob(state, "job-discovery-direct-01", { kind: "CANDIDATE", candidate_id: candidate.candidate_id })],
        } }),
        run_operation: async () => ({ ok: true }),
        prepare_dossier: async () => { throw new TypeError("Discovery must not prepare a dossier") },
      }),
    })
    const stepped = await step.execute({ campaign_id: state.campaign_id, expected_state_revision: 0, mode: "one_stage" }, context)

    const amendDirectory = useTemporaryDirectory()
    const amendState = emptyDiscoveryState()
    await startResearchCampaignState({ directory: amendDirectory, state: amendState })
    const amend = createOpenMathResearchAmendTool({ directory: amendDirectory })
    const amended = await amend.execute({ campaign_id: amendState.campaign_id, expected_state_revision: 0, operation: "add", kind: "required_check", scope: "all_candidates", content: "Check the edge case." }, context)

    const promotionDirectory = useTemporaryDirectory()
    const passed = await createPassedCampaign(promotionDirectory)
    const built = buildPromotionDossier(passed)
    if (!built.ok) throw new TypeError(built.message)
    const checkpoint = await stepResearchCampaign({
      directory: promotionDirectory,
      campaign_id: passed.campaign.campaign_id,
      expected_state_revision: passed.campaign.state_revision,
      mode: "one_stage",
    }, createPromotionDossierStepDependencies({ directory: promotionDirectory }))
    if (!checkpoint.ok || checkpoint.dossier === null) throw new TypeError("Promotion checkpoint is unavailable")
    const promote = createOpenMathResearchPromoteTool({ directory: promotionDirectory })
    const promoted = await promote.execute({
      campaign_id: checkpoint.campaign_id,
      expected_state_revision: checkpoint.state_revision,
      dossier_sha256: checkpoint.dossier.content_sha256,
      decision: "approve",
    }, context)

    const abortDirectory = useTemporaryDirectory()
    const abortState = emptyDiscoveryState()
    await startResearchCampaignState({ directory: abortDirectory, state: abortState })
    const abort = createOpenMathResearchAbortTool({ directory: abortDirectory })
    const aborted = await abort.execute({ campaign_id: abortState.campaign_id, expected_state_revision: 0, reason: "Stop this campaign." }, context)

    // when
    const responses = { start: started, status: statusResult, step: stepped, amend: amended, promote: promoted, abort: aborted }

    // then
    for (const response of Object.values(responses)) {
      expect(CampaignSuccessEnvelopeSchema.safeParse(JSON.parse(response)).success).toBe(true)
    }
    expect({
      start: sha256(started), status: sha256(statusResult), step: sha256(stepped), amend: sha256(amended), abort: sha256(aborted),
    }).toEqual(OldProfileResponseSha256)
    const promotedEnvelope = CampaignSuccessEnvelopeSchema.parse(JSON.parse(promoted))
    expect(promotedEnvelope.dossier?.content_sha256).toBe(sha256(built.reference.serialized_bytes))
    expect(PromotionDossierV1Schema.parse(JSON.parse(built.reference.serialized_bytes))).toEqual(built.dossier)
  })

  test("keeps tool lists and V1 schemas closed against Phase-B-shaped fields", () => {
    // given
    const research = createOpenMathResearchTools({ directory: useTemporaryDirectory(), openmathConfig: researchToolConfig() })
    const workflow = createOpenMathWorkflowTools({ directory: useTemporaryDirectory(), openmathConfig: OpenMathConfigSchema.parse({}) })
    const state = emptyDiscoveryState()
    const readyEnvelope = { ok: true, campaign_id: "campaign-a", state_revision: 0, phase: "DISCOVERY", status: "READY", awaiting_reason: null, candidate_summaries: [], candidate_details: null, selected_candidate_id: null, dossier: null, next_actions: [] }

    // when
    const mutationAccepted = {
      seventh_tool: Object.keys({ ...research, openmath_research_certification: {} }).length === 6,
      campaign_field: ResearchCampaignStateV1Schema.safeParse({ ...state, certification: {} }).success,
      envelope_field: CampaignSuccessEnvelopeSchema.safeParse({ ...readyEnvelope, certification: {} }).success,
      v1_field: PromotionDossierV1Schema.safeParse({ schema_version: 1, certification: {} }).success,
    }

    // then
    expect(Object.keys(research)).toEqual(["openmath_research_start", "openmath_research_status", "openmath_research_step", "openmath_research_amend", "openmath_research_promote", "openmath_research_educationalize", "openmath_research_abort"])
    expect(Object.keys(workflow)).toEqual(["openmath_workflow_start", "openmath_workflow_step", "openmath_workflow_status", "openmath_workflow_amend", "openmath_workflow_reload", "openmath_workflow_abort"])
    expect(mutationAccepted).toEqual({ seventh_tool: false, campaign_field: false, envelope_field: false, v1_field: false })
    expect(CampaignErrorEnvelopeSchema.safeParse({ ok: false, error_code: "VALIDATION_ERROR", message: "invalid" }).success).toBe(true)
    runMutationFailureProbe(mutationAccepted)
  })
})

function useTemporaryDirectory(): string {
  const directory = temporaryCampaignDirectory()
  cleanupDirectories.push(directory)
  return directory
}

function runMutationFailureProbe(mutations: Readonly<{
  readonly seventh_tool: boolean
  readonly campaign_field: boolean
  readonly envelope_field: boolean
  readonly v1_field: boolean
}>): void {
  switch (process.env.OPENMATH_RESEARCH_COMPAT_FAILURE_PROBE) {
    case undefined:
      return
    case "seventh-tool":
      expect(mutations.seventh_tool).toBe(true)
      return
    case "campaign-field":
      expect(mutations.campaign_field).toBe(true)
      return
    case "old-envelope-certification-field":
      expect(mutations.envelope_field).toBe(true)
      return
    case "v1-field":
      expect(mutations.v1_field).toBe(true)
      return
    default:
      throw new TypeError("Unknown compatibility failure probe")
  }
}
