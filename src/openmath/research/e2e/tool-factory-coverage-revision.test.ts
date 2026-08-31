import { afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"

import { createOpenMathResearchTools } from "../../../tools/openmath-research-tools"
import { researchToolContext } from "../../../tools/openmath-research-test-support"
import { createApplicationExtractionCoverageOrchestration } from "../certification/orchestration/extraction-coverage-orchestration"
import { loadCertificationContext } from "../certification/application/load-certification-context"
import { stepResearchCertification } from "../certification/application/step-research-certification"
import { compareAndSwapCertificationGeneration, readCertificationGeneration } from "../certification/storage"
import { readResearchCampaignState } from "../storage"
import { removeTemporaryCampaignDirectory, temporaryCampaignDirectory } from "../application/application-test-fixture"
import { createFactoryStepDependencies, createFactoryTransports } from "./tool-factory-dependencies"
import {
  createCertificationTransportStore,
  createNonCachingCertificationTransport,
} from "./non-caching-certification-transport"
import { createForbiddenOperationProbe } from "./forbidden-operation-probe"
import { storeSnapshot } from "./certification-store-fixture"
import {
  enabledCertificationConfig,
  expectedCoverageRoundPrompt,
  expectedExtractionRoundPrompt,
  nextCertificationStep,
  parseCoverageRoundPrompt,
  parseExtractionRoundPrompt,
  parsePublicError,
  parsePublicResponse,
  requiredCertificationRevision,
} from "./coverage-revision-factory-fixture"

const cleanups: (() => void)[] = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

describe("enabled coverage revision through public research factories", () => {
  test("commits a fresh second extraction after REVISE and reaches attacks after PASS", async () => {
    // given
    const directory = temporaryCampaignDirectory()
    cleanups.push(() => removeTemporaryCampaignDirectory(directory))
    const transportStore = createCertificationTransportStore()
    let transport = createNonCachingCertificationTransport(transportStore)
    const campaignTransports = createFactoryTransports(directory, "KEEP")
    const forbidden = createForbiddenOperationProbe()
    let crashAfterSecondExtractionPublication = false
    const config = enabledCertificationConfig()
    const context = researchToolContext("ses_PhaseBHuman", "msg_PhaseBStep")
    const tools = () => createOpenMathResearchTools({
      directory,
      openmathConfig: config,
      ...forbidden.seams,
      createStepDependencies: () => {
        const campaign = createFactoryStepDependencies(directory, "KEEP", {
          transports: campaignTransports,
          forbidden_operations: forbidden.seams,
        }).dependencies
        return {
          ...campaign,
          step_certification: async (input) => {
            const loaded = await loadCertificationContext(input)
            if (loaded.kind !== "ok") {
              return { kind: "error", error_code: "CAMPAIGN_NOT_ELIGIBLE", message: "Certification context is unavailable" }
            }
            const rounds = createApplicationExtractionCoverageOrchestration(loaded.context, transport.createRuntime)
            return stepResearchCertification(input, {
              ...rounds,
              compare_and_swap_generation: async (request) => {
                const persisted = await compareAndSwapCertificationGeneration(request)
                const secondExtractionPublished = persisted.kind === "ok" && persisted.state.job_attempts.some((attempt) =>
                  attempt.job_id === "cert-job-extraction-0002" && attempt.phase === "COMMITTED")
                if (crashAfterSecondExtractionPublication && secondExtractionPublished) {
                  crashAfterSecondExtractionPublication = false
                  throw new Error("crash after second extraction sidecar publication")
                }
                return persisted
              },
            })
          },
        }
      },
    })
    expect(Object.keys(tools())).toEqual([
      "openmath_research_start",
      "openmath_research_status",
      "openmath_research_step",
      "openmath_research_amend",
      "openmath_research_promote",
      "openmath_research_educationalize",
      "openmath_research_abort",
    ])

    // when
    const started = parsePublicResponse(await tools().openmath_research_start.execute({
      campaign_id: "campaign-a",
      objective: { kind: "markdown", instruction: "Prove the coverage revision objective." },
    }, context))
    const screened = parsePublicResponse(await tools().openmath_research_step.execute({
      campaign_id: started.campaign_id,
      expected_state_revision: started.state_revision,
      expected_certification_revision: null,
      mode: "to_checkpoint",
    }, context))
    const selected = parsePublicResponse(await tools().openmath_research_step.execute({
      campaign_id: started.campaign_id,
      expected_state_revision: screened.state_revision,
      expected_certification_revision: null,
      mode: "one_stage",
    }, context))
    const refined = parsePublicResponse(await tools().openmath_research_step.execute({
      campaign_id: started.campaign_id,
      expected_state_revision: selected.state_revision,
      expected_certification_revision: null,
      mode: "one_stage",
    }, context))
    const extracted = parsePublicResponse(await tools().openmath_research_step.execute({
      campaign_id: started.campaign_id,
      expected_state_revision: refined.state_revision,
      expected_certification_revision: null,
      mode: "one_stage",
    }, context))
    const revised = await nextCertificationStep(tools, context, extracted)
    crashAfterSecondExtractionPublication = true
    const crash = parsePublicError(await tools().openmath_research_step.execute({
      campaign_id: revised.campaign_id,
      expected_state_revision: revised.state_revision,
      expected_certification_revision: requiredCertificationRevision(revised),
      mode: "one_stage",
    }, context))
    transport = createNonCachingCertificationTransport(transportStore)
    const beforeStatus = storeSnapshot(directory)
    const transportBeforeStatus = transport.snapshot()
    const status = parsePublicResponse(await tools().openmath_research_status.execute({ campaign_id: started.campaign_id }, context))
    const afterStatus = storeSnapshot(directory)
    const transportAfterStatus = transport.snapshot()
    const passed = await nextCertificationStep(tools, context, status)
    const aborted = parsePublicResponse(await tools().openmath_research_abort.execute({
      campaign_id: started.campaign_id,
      expected_state_revision: passed.state_revision,
      expected_certification_revision: requiredCertificationRevision(passed),
      reason: "stop after coverage publication evidence",
    }, context))

    // then
    expect(revised).toMatchObject({ certification: { phase: "EXTRACTION", status: "READY" } })
    expect(crash).toMatchObject({
      ok: false,
      error_code: "SUBAGENT_FAILED",
      message: "crash after second extraction sidecar publication",
    })
    expect(status).toMatchObject({ certification: { phase: "COVERAGE_REVIEW", status: "READY" } })
    expect(status.certification.next_actions.map(({ action }) => action)).toEqual([
      "step_one_stage", "step_to_checkpoint", "amend", "abort",
    ])
    expect(status.certification.next_actions.every((action) =>
      action.required_state_revision === status.state_revision
      && action.required_certification_revision === status.certification.certification_revision)).toBe(true)
    expect(passed).toMatchObject({
      ok: true,
      phase: "PROMOTION",
      status: "READY",
      certification: { phase: "COUNTEREXAMPLE_ATTACK", status: "READY" },
    })
    expect(afterStatus).toEqual(beforeStatus)
    expect(transportAfterStatus).toEqual(transportBeforeStatus)
    expect(aborted).toMatchObject({ ok: true, status: "ABORTED", certification: { effective_status: "ABORTED" } })
    const campaign = await readResearchCampaignState(directory, started.campaign_id)
    if (campaign.kind === "error") throw new TypeError(campaign.message)
    const loaded = await loadCertificationContext({ directory, campaign_id: started.campaign_id }, {}, { allow_aborted: true })
    if (loaded.kind !== "ok") throw new TypeError("Certification context is unavailable")
    const certification = await readCertificationGeneration({ directory, ...loaded.context.storage_identity })
    if (certification.kind !== "ok") throw new TypeError("Certification generation is unavailable")
    expect(certification.state.graphs).toHaveLength(2)
    expect(certification.state.graphs[1]?.graph_sha256).toBe(certification.state.graphs[0]?.graph_sha256)
    expect(certification.state.coverage_reviews.map(({ verdict }) => verdict)).toEqual(["REVISE", "PASS"])
    expect(certification.state.job_attempts.map(({ phase }) => phase)).toEqual(["COMMITTED", "COMMITTED", "COMMITTED", "COMMITTED"])
    const childSessions = certification.state.job_attempts.flatMap((attempt) =>
      "child_session_id" in attempt ? [attempt.child_session_id] : [])
    expect(new Set(childSessions).size).toBe(4)
    const transportEvidence = transport.snapshot()
    expect(transportEvidence).toMatchObject({ dispatches: 4, instances: 2, child_sessions: childSessions })
    expect(transportEvidence.requests.map(({ agent }) => agent)).toEqual([
      "extractor", "coverage-reviewer", "extractor", "coverage-reviewer",
    ])
    expect(transportEvidence.requests.every(({ parent_session_id }) => parent_session_id === "ses_PhaseBHuman")).toBe(true)
    expect(transportEvidence.requests.every(({ model }) => model.providerID === "openai" && model.modelID === "gpt-5")).toBe(true)
    expect(transportEvidence.requests.every(({ prompt_marker }) => prompt_marker.startsWith("OPENMATH_CERTIFICATION_JOB_KEY: "))).toBe(true)
    expect(transportEvidence.requests.every(({ send_prompt, persisted_session_id }) => send_prompt && persisted_session_id === null)).toBe(true)
    expect(transportEvidence.requests.map(({ system_content }) => system_content)).toEqual([
      "extractor prompt", "coverage-reviewer prompt", "extractor prompt", "coverage-reviewer prompt",
    ])
    const secondExtractionPrompt = parseExtractionRoundPrompt(transportEvidence.requests[2]?.user_prompt ?? "")
    expect(secondExtractionPrompt).toEqual(expectedExtractionRoundPrompt(loaded.context, certification.state))
    const secondCoveragePrompt = parseCoverageRoundPrompt(transportEvidence.requests[3]?.user_prompt ?? "")
    expect(secondCoveragePrompt).toEqual(expectedCoverageRoundPrompt(loaded.context, certification.state))
    expect(forbidden.counts()).toEqual({
      canonical_export: 0,
      authority_refinement: 0,
      continuation_schedule: 0,
      artifact_patch: 0,
      artifact_merge: 0,
    })
    expect(campaign.state.dossier).toBeNull()
    removeTemporaryCampaignDirectory(directory)
    expect(existsSync(directory)).toBe(false)
  })
})
