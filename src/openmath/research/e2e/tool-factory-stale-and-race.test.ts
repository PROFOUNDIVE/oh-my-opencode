import { existsSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { createOpenMathResearchTools } from "../../../tools/openmath-research-tools"
import { researchToolConfig, researchToolContext } from "../../../tools/openmath-research-test-support"
import { initializeResearchCertification } from "../certification/application/initialize-research-certification"
import { readCertificationGeneration } from "../certification/storage"
import { getResearchCampaignDirectory } from "../storage"
import { createCertificationStoreFixture } from "./certification-store-fixture"

const cleanups: (() => void)[] = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

describe("enabled public stale-artifact and mutation races", () => {
  test("amends only the certification revision and returns exact dual-revision actions", async () => {
    // given
    const harness = createCertificationStoreFixture()
    cleanups.push(harness.cleanup)
    const initialized = await initializeResearchCertification({
      directory: harness.directory,
      campaign_id: harness.fixture.campaign.campaign_id,
      expected_state_revision: harness.fixture.campaign.state_revision,
    })
    if (initialized.kind !== "ok") throw new TypeError(initialized.message)
    const tools = createOpenMathResearchTools({ directory: harness.directory, openmathConfig: researchToolConfig() })
    const amendTool = tools.openmath_research_amend
    if (amendTool === undefined) throw new TypeError("Research amend factory is unavailable")

    // when
    const amended = JSON.parse(String(await amendTool.execute({
      campaign_id: harness.fixture.campaign.campaign_id,
      expected_state_revision: 10,
      expected_certification_revision: 0,
      operation: "add",
      kind: "required_check",
      scope: "coverage",
      content: "Inspect the coverage.",
    }, researchToolContext())))

    // then
    expect(amended).toMatchObject({
      ok: true,
      state_revision: 10,
      certification: {
        certification_revision: 1,
        next_actions: [
          { action: "step_one_stage", required_state_revision: 10, required_certification_revision: 1 },
          { action: "step_to_checkpoint", required_state_revision: 10, required_certification_revision: 1 },
          { action: "amend", required_state_revision: 10, required_certification_revision: 1 },
          { action: "abort", required_state_revision: 10, required_certification_revision: 1 },
        ],
      },
    })
  })

  test("blocks exact selected-artifact content drift before allocating certification", async () => {
    // given
    const harness = createCertificationStoreFixture()
    cleanups.push(harness.cleanup)
    const staleChild = {
      ...harness.fixture.child,
      artifact: harness.fixture.child.artifact === null
        ? null
        : { ...harness.fixture.child.artifact, content: `${harness.fixture.child.artifact.content} ` },
    }
    const tools = createOpenMathResearchTools({
      directory: harness.directory,
      openmathConfig: researchToolConfig(),
      createStepDependencies: () => ({
        plan_operation: () => ({ ok: false, error_code: "ILLEGAL_TRANSITION", message: "campaign work is complete" }),
        run_operation: async () => ({ ok: false, error_code: "ILLEGAL_TRANSITION", message: "campaign work is complete" }),
        prepare_dossier: async () => ({ kind: "error", error_code: "VALIDATION_ERROR", message: "certification must run first" }),
        step_certification: (input) => initializeResearchCertification(input, {
          read_child: async () => ({ kind: "ok", state: staleChild }),
        }),
      }),
    })
    const stepTool = tools.openmath_research_step
    if (stepTool === undefined) throw new TypeError("Research step factory is unavailable")

    // when
    const result = JSON.parse(String(await stepTool.execute({
      campaign_id: harness.fixture.campaign.campaign_id,
      expected_state_revision: harness.fixture.campaign.state_revision,
      expected_certification_revision: null,
      mode: "one_stage",
    }, researchToolContext())))

    // then
    expect(result).toMatchObject({ ok: false, error_code: "STALE_ARTIFACT" })
    expect(existsSync(join(getResearchCampaignDirectory(harness.directory, harness.fixture.campaign.campaign_id), "certification"))).toBe(false)
  })

  test("makes campaign abort authoritative over concurrent amend and status without an attachment", async () => {
    // given
    const harness = createCertificationStoreFixture()
    cleanups.push(harness.cleanup)
    const initialized = await initializeResearchCertification({
      directory: harness.directory,
      campaign_id: harness.fixture.campaign.campaign_id,
      expected_state_revision: harness.fixture.campaign.state_revision,
    })
    if (initialized.kind !== "ok") throw new TypeError(initialized.message)
    const tools = createOpenMathResearchTools({ directory: harness.directory, openmathConfig: researchToolConfig() })
    const amendTool = tools.openmath_research_amend
    const abortTool = tools.openmath_research_abort
    const statusTool = tools.openmath_research_status
    if (amendTool === undefined || abortTool === undefined || statusTool === undefined) throw new TypeError("Research factories are unavailable")

    // when
    const [amended, aborted] = await Promise.all([
      amendTool.execute({
        campaign_id: harness.fixture.campaign.campaign_id,
        expected_state_revision: 10,
        expected_certification_revision: 0,
        operation: "add",
        kind: "question",
        scope: "coverage",
        content: "Recheck coverage.",
      }, researchToolContext()),
      abortTool.execute({
        campaign_id: harness.fixture.campaign.campaign_id,
        expected_state_revision: 10,
        expected_certification_revision: 0,
        reason: "stop",
      }, researchToolContext()),
      statusTool.execute({ campaign_id: harness.fixture.campaign.campaign_id }, researchToolContext()),
    ])
    const final = JSON.parse(String(await statusTool.execute({ campaign_id: harness.fixture.campaign.campaign_id }, researchToolContext())))
    const generation = await readCertificationGeneration({
      directory: harness.directory,
      campaign_id: initialized.state.campaign_id,
      selected_artifact: initialized.state.selected_artifact,
      certification_profile_sha256: initialized.state.certification_profile_sha256,
      initialized_from_campaign_revision: 10,
    })

    // then
    const amendment = JSON.parse(String(amended))
    expect(amendment.ok === true || ["ABORTED", "STALE_CERTIFICATION_REVISION", "STALE_STATE_REVISION"].includes(amendment.error_code)).toBe(true)
    expect(JSON.parse(String(aborted))).toMatchObject({ ok: true, status: "ABORTED" })
    expect(final).toMatchObject({ ok: true, status: "ABORTED", certification: { effective_status: "ABORTED" } })
    expect(final.certification.attachment).toBeNull()
    expect(generation).toMatchObject({ kind: "ok", state: { status: "ABORTED" } })
  })
})
