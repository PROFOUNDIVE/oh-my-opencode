import { afterEach, describe, expect, test } from "bun:test"

import { researchToolConfig, researchToolContext } from "../../../tools/openmath-research-test-support"
import { createOpenMathResearchTools } from "../../../tools/openmath-research-tools"
import { stepResearchCertification } from "../certification/application/step-research-certification"
import { createPromotionDossierStepDependencies } from "../dossier"
import { createCertificationV2StoreFixture } from "../e2e/certification-v2-store-fixture"
import { validateApprovedEducationalSource } from "./approved-source"

const cleanups: Array<() => void> = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

describe("approved research educational source", () => {
  test("rejects educationalization before explicit approval", async () => {
    const harness = createCertificationV2StoreFixture()
    cleanups.push(harness.cleanup)

    const result = await validateApprovedEducationalSource({
      directory: harness.directory,
      campaign_id: harness.fixture.campaign.campaign_id,
      expected_state_revision: harness.fixture.campaign.state_revision,
      expected_certification_revision: harness.fixture.certification.certification_revision,
      dossier_sha256: "0".repeat(64),
    })

    expect(result).toMatchObject({ ok: false, error_code: "CAMPAIGN_NOT_APPROVED" })
  })

  test("binds the exact selected artifact and certification after approval", async () => {
    const approved = await approvedFixture()

    const result = await validateApprovedEducationalSource({
      directory: approved.directory,
      campaign_id: approved.campaign_id,
      expected_state_revision: approved.state_revision,
      expected_certification_revision: approved.certification_revision,
      dossier_sha256: approved.dossier_sha256,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new TypeError(result.message)
    expect(result.source.reference_solution).toBe("Theorem\nLemma\nClaim\nDefinition\nImported\nComputation")
    expect(result.source.reference_solution_sha256).toBe(result.source.selected_artifact.artifact_sha256)
    expect(result.source.certification.certification_revision).toBe(approved.certification_revision)
  })

  test("rejects stale dossier and certification identities", async () => {
    const approved = await approvedFixture()

    const wrongDossier = await validateApprovedEducationalSource({
      directory: approved.directory,
      campaign_id: approved.campaign_id,
      expected_state_revision: approved.state_revision,
      expected_certification_revision: approved.certification_revision,
      dossier_sha256: "f".repeat(64),
    })
    const wrongCertification = await validateApprovedEducationalSource({
      directory: approved.directory,
      campaign_id: approved.campaign_id,
      expected_state_revision: approved.state_revision,
      expected_certification_revision: approved.certification_revision + 1,
      dossier_sha256: approved.dossier_sha256,
    })

    expect(wrongDossier).toMatchObject({ ok: false, error_code: "DOSSIER_HASH_MISMATCH" })
    expect(wrongCertification).toMatchObject({ ok: false, error_code: "CERTIFICATION_SOURCE_MISMATCH" })
  })
})

async function approvedFixture(): Promise<Readonly<{
  directory: string
  campaign_id: string
  state_revision: number
  certification_revision: number
  dossier_sha256: string
}>> {
  const harness = createCertificationV2StoreFixture()
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
  const step = tools.openmath_research_step
  const promote = tools.openmath_research_promote
  if (step === undefined || promote === undefined) throw new TypeError("Research tools are unavailable")
  const checkpoint = JSON.parse(String(await step.execute({
    campaign_id: harness.fixture.campaign.campaign_id,
    expected_state_revision: harness.fixture.campaign.state_revision,
    expected_certification_revision: harness.fixture.certification.certification_revision,
    mode: "one_stage",
  }, researchToolContext())))
  const promoted = JSON.parse(String(await promote.execute({
    campaign_id: harness.fixture.campaign.campaign_id,
    expected_state_revision: checkpoint.state_revision,
    expected_certification_revision: harness.fixture.certification.certification_revision,
    dossier_sha256: checkpoint.dossier.content_sha256,
    decision: "approve",
  }, researchToolContext())))
  if (promoted.ok !== true) throw new TypeError(JSON.stringify(promoted))
  return {
    directory: harness.directory,
    campaign_id: harness.fixture.campaign.campaign_id,
    state_revision: promoted.state_revision,
    certification_revision: harness.fixture.certification.certification_revision,
    dossier_sha256: checkpoint.dossier.content_sha256,
  }
}
