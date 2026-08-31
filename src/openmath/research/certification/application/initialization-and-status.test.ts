import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import {
  removeTemporaryCampaignDirectory,
  temporaryCampaignDirectory,
} from "../../application/application-test-fixture"
import { readCertificationGeneration } from "../storage"
import { applicationStorageWithoutCampaignGuard, certifiedPromotionFixture, legacyPromotionFixture } from "./certification-application-test-fixture"
import { getResearchCertificationStatus } from "./get-research-certification-status"
import { initializeResearchCertification } from "./initialize-research-certification"
import { readResearchCertification } from "./read-research-certification"

describe("certification initialization and status", () => {
  let directory: string

  beforeEach(() => {
    directory = temporaryCampaignDirectory()
  })

  afterEach(() => {
    removeTemporaryCampaignDirectory(directory)
  })

  test("initializes revision zero only after exact selected artifact revalidation", async () => {
    // given
    const fixture = certifiedPromotionFixture()

    // when
    const result = await initializeResearchCertification({
      directory,
      campaign_id: fixture.campaign.campaign_id,
      expected_state_revision: fixture.campaign.state_revision,
    }, readers(fixture))

    // then
    expect(result).toMatchObject({ kind: "ok", state: { certification_revision: 0, status: "READY" } })
    if (result.kind !== "ok") throw new TypeError("Expected initialized certification")
    const stored = await readCertificationGeneration({
      directory,
      campaign_id: fixture.campaign.campaign_id,
      selected_artifact: result.state.selected_artifact,
      certification_profile_sha256: result.state.certification_profile_sha256,
      initialized_from_campaign_revision: fixture.campaign.state_revision,
    })
    expect(stored).toMatchObject({ kind: "ok", state: { certification_revision: 0 } })
  })

  test("rejects hash-equivalent parsed JSON when exact persisted bytes differ", async () => {
    // given
    const fixture = certifiedPromotionFixture()
    const changedChild = {
      ...fixture.child,
      artifact: fixture.child.artifact === null ? null : {
        ...fixture.child.artifact,
        content: "{ \"theorem\": \"exact legacy bytes\" }",
      },
    }

    // when
    const result = await initializeResearchCertification({
      directory,
      campaign_id: fixture.campaign.campaign_id,
      expected_state_revision: fixture.campaign.state_revision,
    }, readers({ campaign: fixture.campaign, child: changedChild }))

    // then
    expect(result).toMatchObject({ kind: "error", error_code: "STALE_ARTIFACT" })
  })

  test("reads the exact initialized sidecar without mutation", async () => {
    // given
    const fixture = certifiedPromotionFixture()
    const initialized = await initializeResearchCertification({
      directory,
      campaign_id: fixture.campaign.campaign_id,
      expected_state_revision: fixture.campaign.state_revision,
    }, readers(fixture))
    if (initialized.kind !== "ok") throw new TypeError("Expected initialized certification")

    // when
    const result = await readResearchCertification({ directory, campaign_id: fixture.campaign.campaign_id }, readers(fixture))

    // then
    expect(result).toMatchObject({ kind: "ok", read: { state: { certification_revision: 0 } } })
  })

  test("status is read-only and reports revision orphans without repairing them", async () => {
    // given
    const fixture = certifiedPromotionFixture()
    const initialized = await initializeResearchCertification({
      directory,
      campaign_id: fixture.campaign.campaign_id,
      expected_state_revision: fixture.campaign.state_revision,
    }, readers(fixture))
    if (initialized.kind !== "ok") throw new TypeError("Expected initialized certification")
    let mutations = 0

    // when
    const status = await getResearchCertificationStatus({
      directory,
      campaign_id: fixture.campaign.campaign_id,
    }, {
      ...readers(fixture),
      read_generation: async () => ({
        kind: "error",
        error_code: "STORAGE_READ_FAILED",
        reason: "REVISION_WITHOUT_INDEX",
        message: "orphan",
      }),
      initialize_generation: async () => {
        mutations += 1
        return { kind: "error", error_code: "STORAGE_WRITE_FAILED", message: "must not run" }
      },
      repair_generation_index: async () => {
        mutations += 1
        return { kind: "error", error_code: "STORAGE_WRITE_FAILED", message: "must not run" }
      },
    })

    // then
    expect(status).toMatchObject({ kind: "error", error_code: "STORAGE_READ_FAILED", reason: "REVISION_WITHOUT_INDEX" })
    expect(mutations).toBe(0)
  })

  test("old profiles never inspect or allocate certification storage", async () => {
    // given
    const fixture = legacyPromotionFixture()
    let sidecarCalls = 0

    // when
    const status = await getResearchCertificationStatus({
      directory,
      campaign_id: fixture.campaign.campaign_id,
    }, {
      ...readers(fixture),
      read_generation: async () => {
        sidecarCalls += 1
        return { kind: "not_started" }
      },
      initialize_generation: async () => {
        sidecarCalls += 1
        return { kind: "error", error_code: "STORAGE_WRITE_FAILED", message: "must not run" }
      },
    })

    // then
    expect(status).toMatchObject({ kind: "disabled" })
    expect(sidecarCalls).toBe(0)
  })

  test("binds initialization to the validated campaign revision while storage is locked", async () => {
    // given
    const fixture = certifiedPromotionFixture()
    let request: unknown

    // when
    await initializeResearchCertification({
      directory,
      campaign_id: fixture.campaign.campaign_id,
      expected_state_revision: fixture.campaign.state_revision,
    }, {
      ...readers(fixture),
      initialize_generation: async (input) => {
        request = input
        return { kind: "ok", state: input.state }
      },
    })

    // then
    expect(request).toMatchObject({
      campaign_guard: {
        expected_state_revision: fixture.campaign.state_revision,
        expected_status: "READY",
      },
    })
  })
})

function readers(fixture: ReturnType<typeof certifiedPromotionFixture>) {
  return {
    ...applicationStorageWithoutCampaignGuard,
    read_campaign: async () => ({ kind: "ok" as const, state: fixture.campaign }),
    read_child: async () => ({ kind: "ok" as const, state: fixture.child }),
  }
}
