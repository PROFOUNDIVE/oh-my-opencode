import { rmSync, writeFileSync } from "node:fs"
import { afterEach, describe, expect, test } from "bun:test"

import { createOpenMathResearchTools } from "../../../tools/openmath-research-tools"
import { researchToolConfig, researchToolContext } from "../../../tools/openmath-research-test-support"
import { initializeResearchCertification } from "../certification/application/initialize-research-certification"
import { getCertificationGenerationIndexPath, getCertificationRevisionPath } from "../certification/storage"
import { getCertificationGenerationDirectory } from "../certification/storage/paths"
import { createCertificationStoreFixture } from "./certification-store-fixture"

const cleanups: (() => void)[] = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

describe("enabled public status storage narratives", () => {
  test("reports both-absent NOT_STARTED without changing campaign storage", async () => {
    // given
    const harness = createCertificationStoreFixture()
    cleanups.push(harness.cleanup)
    const before = harness.snapshot()

    // when
    const result = await status(harness)

    // then
    expect(result.certification).toEqual({
      status: "NOT_STARTED",
      effective_status: "NOT_STARTED",
      certification_revision: null,
      phase: null,
      awaiting_reason: null,
      blocked_reason: null,
      content_sha256: null,
      summary: null,
      attachment: null,
      storage_anomaly: null,
      next_actions: [
        { action: "step_one_stage", required_state_revision: 10, reason: "READY_TO_RUN" },
        { action: "step_to_checkpoint", required_state_revision: 10, reason: "READY_TO_RUN" },
        { action: "abort", required_state_revision: 10, reason: "READY_TO_RUN" },
      ],
    })
    expect(harness.snapshot()).toEqual(before)
  })

  test.each(["revision-only", "index-only", "corrupt-highest"] as const)(
    "reports %s as a read-only storage anomaly",
    async (anomaly) => {
      // given
      const harness = createCertificationStoreFixture()
      cleanups.push(harness.cleanup)
      const initialized = await initializeResearchCertification({
        directory: harness.directory,
        campaign_id: harness.fixture.campaign.campaign_id,
        expected_state_revision: harness.fixture.campaign.state_revision,
      })
      if (initialized.kind !== "ok") throw new TypeError(initialized.message)
      const generationDirectory = getCertificationGenerationDirectory(
        harness.directory,
        initialized.state.campaign_id,
        initialized.state.generation_id,
      )
      if (anomaly === "revision-only") {
        rmSync(getCertificationGenerationIndexPath(harness.directory, initialized.state.campaign_id))
      } else if (anomaly === "index-only") {
        rmSync(getCertificationRevisionPath(generationDirectory, 0))
      } else {
        writeFileSync(getCertificationRevisionPath(generationDirectory, 1), "{corrupt")
      }
      const before = harness.snapshot()

      // when
      const result = await status(harness)

      // then
      expect(result).toMatchObject({
        ok: true,
        certification: {
          status: "STORAGE_ANOMALY",
          effective_status: "NOT_STARTED",
          certification_revision: null,
          next_actions: [{ action: "abort", required_state_revision: 10, reason: "READY_TO_RUN" }],
        },
      })
      expect(harness.snapshot()).toEqual(before)
    },
  )

  test("keeps campaign abort authoritative over a revision orphan without status repair", async () => {
    // given
    const harness = createCertificationStoreFixture()
    cleanups.push(harness.cleanup)
    const initialized = await initializeResearchCertification({
      directory: harness.directory,
      campaign_id: harness.fixture.campaign.campaign_id,
      expected_state_revision: harness.fixture.campaign.state_revision,
    })
    if (initialized.kind !== "ok") throw new TypeError(initialized.message)
    rmSync(getCertificationGenerationIndexPath(harness.directory, initialized.state.campaign_id))
    const tools = createOpenMathResearchTools({ directory: harness.directory, openmathConfig: researchToolConfig() })
    const abortTool = tools.openmath_research_abort
    if (abortTool === undefined) throw new TypeError("Research abort factory is unavailable")
    const aborted = JSON.parse(String(await abortTool.execute({
      campaign_id: harness.fixture.campaign.campaign_id,
      expected_state_revision: harness.fixture.campaign.state_revision,
      expected_certification_revision: null,
      reason: "stop",
    }, researchToolContext())))
    const beforeStatus = harness.snapshot()

    // when
    const result = await status(harness)

    // then
    expect(aborted).toEqual({
      ok: false,
      error_code: "SIDECAR_CLEANUP_FAILED",
      message: "Certification revision exists without a generation index",
      current_state_revision: 11,
      campaign_aborted: true,
    })
    expect(result).toMatchObject({
      ok: true,
      status: "ABORTED",
      certification: { status: "STORAGE_ANOMALY", effective_status: "ABORTED", next_actions: [] },
    })
    expect(harness.snapshot()).toEqual(beforeStatus)
  })
})

async function status(harness: ReturnType<typeof createCertificationStoreFixture>) {
  const tools = createOpenMathResearchTools({
    directory: harness.directory,
    openmathConfig: researchToolConfig(),
  })
  const statusTool = tools.openmath_research_status
  if (statusTool === undefined) throw new TypeError("Research status factory is unavailable")
  return JSON.parse(String(await statusTool.execute({
    campaign_id: harness.fixture.campaign.campaign_id,
  }, researchToolContext())))
}
