import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, renameSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { getOpenMathStorageDirectory } from "../openmath/storage-directory"
import { removeTemporaryCampaignDirectory } from "../openmath/research/application/application-test-fixture"
import { stepResearchCertification } from "../openmath/research/certification/application/step-research-certification"
import { createPromotionDossierStepDependencies } from "../openmath/research/dossier"
import { validateApprovedEducationalSource } from "../openmath/research/educationalization/approved-source"
import { fakeRuntime, profileSnapshot } from "../openmath/research/educationalization/educationalize-research-campaign-test-fixture"
import { createCertificationV2StoreFixture } from "../openmath/research/e2e/certification-v2-store-fixture"
import { readWorkflowState } from "../openmath/workflow/storage"
import { createOpenMathResearchTools } from "./openmath-research-tools"
import { researchToolConfig, researchToolContext } from "./openmath-research-test-support"

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

describe("certified research with local storage", () => {
  test("promotes and freezes educational derivatives from local certification evidence", async () => {
    // given
    const harness = createCertificationV2StoreFixture()
    const root = mkdtempSync(join(tmpdir(), "research-certified-storage-"))
    cleanups.push(harness.cleanup, () => removeTemporaryCampaignDirectory(root))
    const directory = harness.directory
    const storageDirectory = getOpenMathStorageDirectory(directory, root)
    mkdirSync(storageDirectory, { recursive: true })
    renameSync(join(directory, ".sisyphus"), join(storageDirectory, ".sisyphus"))
    const dossier = createPromotionDossierStepDependencies({ directory: storageDirectory })
    const control = { dispatches: 0, reviews: ["PASS"] }
    const tools = createOpenMathResearchTools({
      directory,
      openmathConfig: { ...researchToolConfig(), storage_root: root },
      createStepDependencies: () => ({
        plan_operation: () => ({ ok: false, error_code: "ILLEGAL_TRANSITION", message: "unused" }),
        run_operation: async () => ({ ok: false, error_code: "ILLEGAL_TRANSITION", message: "unused" }),
        prepare_dossier: dossier.prepare_dossier,
        step_certification: (input) => stepResearchCertification(input, {
          plan_operation: () => ({ ok: false, error_code: "ILLEGAL_TRANSITION", message: "unused" }),
          run_operation: async () => ({ ok: false, error_code: "ILLEGAL_TRANSITION", message: "unused" }),
        }),
      }),
      resolveEducationalizationProfile: async () => profileSnapshot(),
      createEducationalizationRuntime: ({ state }) => {
        if (state.request_snapshot?.kind !== "research_educationalization") throw new TypeError("Missing approved source")
        return fakeRuntime(storageDirectory, state, state.request_snapshot, control)
      },
    })
    const execute = async (name: string, input: Record<string, unknown>) => {
      const selected = tools[name]
      if (selected === undefined) throw new TypeError(`Missing tool ${name}`)
      return JSON.parse(await selected.execute(input, researchToolContext()))
    }
    const campaign_id = harness.fixture.campaign.campaign_id
    const expected_certification_revision = harness.fixture.certification.certification_revision

    // when
    const checkpoint = await execute("openmath_research_step", {
      campaign_id, expected_state_revision: harness.fixture.campaign.state_revision,
      expected_certification_revision, mode: "one_stage",
    })
    expect(checkpoint).toMatchObject({ ok: true })
    const approved = await execute("openmath_research_promote", {
      campaign_id, expected_state_revision: checkpoint.state_revision,
      expected_certification_revision, dossier_sha256: checkpoint.dossier.content_sha256, decision: "approve",
    })
    expect(approved).toMatchObject({ ok: true, status: "PROMOTION_READY" })
    const request = {
      campaign_id, expected_state_revision: approved.state_revision,
      expected_certification_revision, dossier_sha256: checkpoint.dossier.content_sha256,
    }
    const educationalized = await execute("openmath_research_educationalize", request)

    // then
    expect(educationalized).toMatchObject({ ok: true, status: "FROZEN" })
    expect(await execute("openmath_research_educationalize", request)).toEqual(educationalized)
    expect(control.dispatches).toBe(2)
    const stored = await readWorkflowState(storageDirectory, educationalized.educationalization_id)
    expect(stored.kind).toBe("ok")
    if (stored.kind !== "ok") throw new TypeError(stored.message)
    expect(stored.state.status).toBe("PASSED")
    expect(JSON.parse(stored.state.artifact?.content ?? "{}").reference_solution).toBe(harness.fixture.child.artifact?.content)
    expect(await validateApprovedEducationalSource({ ...request, directory, storageDirectory })).toMatchObject({ ok: true })
    expect(await execute("openmath_research_educationalize", { ...request, expected_state_revision: approved.state_revision - 1 }))
      .toMatchObject({ ok: false, error_code: "STALE_STATE_REVISION" })
    expect(existsSync(join(directory, ".sisyphus"))).toBe(false)
  })
})
