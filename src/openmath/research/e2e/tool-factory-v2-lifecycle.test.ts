import { afterEach, describe, expect, test } from "bun:test"

import { createOpenMathResearchTools } from "../../../tools/openmath-research-tools"
import { researchToolConfig, researchToolContext } from "../../../tools/openmath-research-test-support"
import { stepResearchCertification } from "../certification/application/step-research-certification"
import { PromotionDossierV2Schema } from "../dossier/promotion-dossier-v2-schema"
import { createPromotionDossierStepDependencies } from "../dossier"
import { readResearchCampaignState } from "../storage"
import { sha256 } from "../../workflow/stage-runner/sha256"
import { createCertificationV2StoreFixture } from "./certification-v2-store-fixture"

const cleanups: (() => void)[] = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

describe("enabled V2 public tool-factory lifecycle", () => {
  test.each([
    [undefined, "approve", "PROMOTION_READY", true],
    ["REJECTED", "approve", "PROMOTION_READY", true],
    ["INCONCLUSIVE", "reject", "REJECTED", false],
    ["CONFIRMED", "reject", "REJECTED", false],
  ] as const)("projects %s witness evidence through %s", async (witness, decision, finalStatus, approvalEligible) => {
    // given
    const harness = createCertificationV2StoreFixture(witness)
    cleanups.push(harness.cleanup)
    const dossier = createPromotionDossierStepDependencies({ directory: harness.directory })
    const tools = createOpenMathResearchTools({
      directory: harness.directory,
      openmathConfig: researchToolConfig(),
      createStepDependencies: () => ({
        plan_operation: () => ({ ok: false, error_code: "ILLEGAL_TRANSITION", message: "complete certification cannot plan" }),
        run_operation: async () => ({ ok: false, error_code: "ILLEGAL_TRANSITION", message: "complete certification cannot run" }),
        prepare_dossier: dossier.prepare_dossier,
        step_certification: (input) => stepResearchCertification(input, {
          plan_operation: () => ({ ok: false, error_code: "ILLEGAL_TRANSITION", message: "complete certification cannot plan" }),
          run_operation: async () => ({ ok: false, error_code: "ILLEGAL_TRANSITION", message: "complete certification cannot run" }),
        }),
      }),
    })
    expect(Object.keys(tools)).toEqual([
      "openmath_research_start",
      "openmath_research_status",
      "openmath_research_step",
      "openmath_research_amend",
      "openmath_research_promote",
      "openmath_research_educationalize",
      "openmath_research_abort",
    ])
    const stepTool = tools.openmath_research_step
    const promoteTool = tools.openmath_research_promote
    if (stepTool === undefined || promoteTool === undefined) throw new TypeError("Research factories are unavailable")

    // when
    const checkpoint = JSON.parse(String(await stepTool.execute({
      campaign_id: harness.fixture.campaign.campaign_id,
      expected_state_revision: harness.fixture.campaign.state_revision,
      expected_certification_revision: harness.fixture.certification.certification_revision,
      mode: "one_stage",
    }, researchToolContext())))
    const stored = await readResearchCampaignState(harness.directory, harness.fixture.campaign.campaign_id)
    if (stored.kind === "error") throw new TypeError(stored.message)
    const dossierBytes = stored.state.dossier?.serialized_bytes
    if (typeof dossierBytes !== "string") throw new TypeError(`Expected V2 dossier bytes: ${JSON.stringify(checkpoint)}`)
    const parsedDossier = PromotionDossierV2Schema.parse(JSON.parse(dossierBytes))
    const certificationAttachment = harness.fixture.campaign.attachments.find(({ kind }) => kind === "research-certification")
    if (certificationAttachment === undefined) throw new TypeError("Expected published certification attachment")
    const promoted = JSON.parse(String(await promoteTool.execute({
      campaign_id: harness.fixture.campaign.campaign_id,
      expected_state_revision: checkpoint.state_revision,
      expected_certification_revision: harness.fixture.certification.certification_revision,
      dossier_sha256: checkpoint.dossier.content_sha256,
      decision,
    }, researchToolContext())))

    // then
    expect(checkpoint).toMatchObject({
      ok: true,
      state_revision: 12,
      status: "AWAITING_HUMAN",
      awaiting_reason: "BEFORE_PROMOTION",
      certification: {
        status: "COMPLETE",
        certification_revision: harness.fixture.certification.certification_revision,
        summary: { approval_eligible: approvalEligible },
      },
    })
    expect(parsedDossier.schema_version).toBe(2)
    expect(checkpoint.dossier.content_sha256).toBe(sha256(dossierBytes))
    expect(JSON.stringify(parsedDossier.certification_attachment)).toBe(JSON.stringify(certificationAttachment))
    expect(promoted).toMatchObject({ ok: true, status: finalStatus, next_actions: [] })
  })

  test.each(["INCONCLUSIVE", "CONFIRMED"] as const)("keeps %s visible but rejects approval", async (witness) => {
    // given
    const harness = createCertificationV2StoreFixture(witness)
    cleanups.push(harness.cleanup)
    const dossier = createPromotionDossierStepDependencies({ directory: harness.directory })
    const tools = createOpenMathResearchTools({
      directory: harness.directory,
      openmathConfig: researchToolConfig(),
      createStepDependencies: () => ({
        plan_operation: () => ({ ok: false, error_code: "ILLEGAL_TRANSITION", message: "unused" }),
        run_operation: async () => ({ ok: false, error_code: "ILLEGAL_TRANSITION", message: "unused" }),
        prepare_dossier: dossier.prepare_dossier,
        step_certification: (input) => stepResearchCertification(input, {
          plan_operation: () => ({ ok: false, error_code: "ILLEGAL_TRANSITION", message: "unused" }),
          run_operation: async () => ({ ok: false, error_code: "ILLEGAL_TRANSITION", message: "unused" }),
        }),
      }),
    })
    const stepTool = tools.openmath_research_step
    const promoteTool = tools.openmath_research_promote
    if (stepTool === undefined || promoteTool === undefined) throw new TypeError("Research factories are unavailable")
    const checkpoint = JSON.parse(String(await stepTool.execute({
      campaign_id: harness.fixture.campaign.campaign_id,
      expected_state_revision: 11,
      expected_certification_revision: harness.fixture.certification.certification_revision,
    }, researchToolContext())))

    // when
    const result = JSON.parse(String(await promoteTool.execute({
      campaign_id: harness.fixture.campaign.campaign_id,
      expected_state_revision: checkpoint.state_revision,
      expected_certification_revision: harness.fixture.certification.certification_revision,
      dossier_sha256: checkpoint.dossier.content_sha256,
      decision: "approve",
    }, researchToolContext())))

    // then
    expect(result).toMatchObject({ ok: false, error_code: "VALIDATION_ERROR", message: "PromotionDossierV2 certification is not approval eligible" })
    expect(checkpoint.certification.summary.witness_outcomes[witness.toLowerCase()]).toBe(1)
  })
})
