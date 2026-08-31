import { rmSync } from "node:fs"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import {
  removeTemporaryCampaignDirectory,
  temporaryCampaignDirectory,
} from "../../application/application-test-fixture"
import { getCertificationGenerationIndexPath, readCertificationGeneration } from "../storage"
import { compareAndSwapCertificationGeneration } from "../storage"
import { reduceCertificationTransition } from "../transitions"
import { abortResearchCertification } from "./abort-research-certification"
import { applicationStorageWithoutCampaignGuard, certifiedPromotionFixture } from "./certification-application-test-fixture"
import { initializeResearchCertification } from "./initialize-research-certification"

describe("certification abort ordering", () => {
  let directory: string

  beforeEach(() => {
    directory = temporaryCampaignDirectory()
  })

  afterEach(() => {
    removeTemporaryCampaignDirectory(directory)
  })

  test("commits campaign ABORTED before appending sidecar ABORTED", async () => {
    // given
    const fixture = certifiedPromotionFixture()
    let campaign = fixture.campaign
    const campaignStorage = {
      read_campaign: async () => ({ kind: "ok" as const, state: campaign }),
      compare_and_swap_campaign: async (request: { readonly next_state: typeof campaign }) => {
        campaign = request.next_state
        return { kind: "ok" as const, state: campaign }
      },
    }
    const initialized = await initializeResearchCertification({
      directory,
      campaign_id: fixture.campaign.campaign_id,
      expected_state_revision: fixture.campaign.state_revision,
    }, { ...childReader(fixture), ...campaignStorage })
    if (initialized.kind !== "ok") throw new TypeError(initialized.message)

    // when
    const result = await abortResearchCertification({
      directory,
      campaign_id: fixture.campaign.campaign_id,
      expected_state_revision: fixture.campaign.state_revision,
      expected_certification_revision: 0,
      reason: "stop",
    }, { ...childReader(fixture), ...campaignStorage })

    // then
    expect(result).toMatchObject({ kind: "ok", campaign: { status: "ABORTED" }, certification: { status: "ABORTED" } })
    expect(campaign).toMatchObject({ status: "ABORTED" })
    const sidecar = await readCertificationGeneration({
      directory,
      campaign_id: fixture.campaign.campaign_id,
      selected_artifact: initialized.state.selected_artifact,
      certification_profile_sha256: initialized.state.certification_profile_sha256,
      initialized_from_campaign_revision: fixture.campaign.state_revision,
    })
    expect(sidecar).toMatchObject({ kind: "ok", state: { status: "ABORTED" } })
  })

  test("authoritatively aborts campaign without repairing a revision orphan", async () => {
    // given
    const fixture = certifiedPromotionFixture()
    let campaign = fixture.campaign
    const campaignStorage = {
      read_campaign: async () => ({ kind: "ok" as const, state: campaign }),
      compare_and_swap_campaign: async (request: { readonly next_state: typeof campaign }) => {
        campaign = request.next_state
        return { kind: "ok" as const, state: campaign }
      },
    }
    const initialized = await initializeResearchCertification({
      directory,
      campaign_id: fixture.campaign.campaign_id,
      expected_state_revision: fixture.campaign.state_revision,
    }, { ...childReader(fixture), ...campaignStorage })
    if (initialized.kind !== "ok") throw new TypeError(initialized.message)
    rmSync(getCertificationGenerationIndexPath(directory, fixture.campaign.campaign_id))
    let sidecarMutations = 0

    // when
    const result = await abortResearchCertification({
      directory,
      campaign_id: fixture.campaign.campaign_id,
      expected_state_revision: fixture.campaign.state_revision,
      expected_certification_revision: null,
      reason: "stop",
    }, {
      ...childReader(fixture),
      ...campaignStorage,
      compare_and_swap_generation: async () => {
        sidecarMutations += 1
        return { kind: "error", error_code: "STORAGE_WRITE_FAILED", message: "must not run" }
      },
      repair_generation_index: async () => {
        sidecarMutations += 1
        return { kind: "error", error_code: "STORAGE_WRITE_FAILED", message: "must not run" }
      },
    })

    // then
    expect(result).toMatchObject({ kind: "error", error_code: "SIDECAR_CLEANUP_FAILED", campaign: { status: "ABORTED" } })
    expect(sidecarMutations).toBe(0)
    expect(campaign).toMatchObject({ status: "ABORTED" })
  })

  test("cleans up the latest nonterminal sidecar after a pre-abort writer wins the lock", async () => {
    // given
    const fixture = certifiedPromotionFixture()
    let campaign = fixture.campaign
    const initialized = await initializeResearchCertification({
      directory,
      campaign_id: fixture.campaign.campaign_id,
      expected_state_revision: fixture.campaign.state_revision,
    }, {
      ...childReader(fixture),
      read_campaign: async () => ({ kind: "ok" as const, state: campaign }),
    })
    if (initialized.kind !== "ok") throw new TypeError(initialized.message)
    const advanced = reduceCertificationTransition(initialized.state, {
      type: "ADD_AMENDMENT",
      kind: "question",
      scope: "coverage",
      content: "Concurrent note",
    }, 0)
    if (!advanced.ok) throw new TypeError(advanced.message)

    // when
    const result = await abortResearchCertification({
      directory,
      campaign_id: fixture.campaign.campaign_id,
      expected_state_revision: fixture.campaign.state_revision,
      expected_certification_revision: 0,
      reason: "stop",
    }, {
      ...childReader(fixture),
      read_campaign: async () => ({ kind: "ok" as const, state: campaign }),
      compare_and_swap_campaign: async (request) => {
        const sidecarWrite = await compareAndSwapCertificationGeneration({
          directory,
          identity: {
            campaign_id: initialized.state.campaign_id,
            selected_artifact: initialized.state.selected_artifact,
            certification_profile_sha256: initialized.state.certification_profile_sha256,
            initialized_from_campaign_revision: fixture.campaign.state_revision,
          },
          expected_certification_revision: 0,
          next_state: advanced.state,
        })
        if (sidecarWrite.kind !== "ok") throw new TypeError(sidecarWrite.message)
        campaign = request.next_state
        return { kind: "ok" as const, state: campaign }
      },
    })

    // then
    expect(result).toMatchObject({ kind: "ok", certification: { status: "ABORTED", certification_revision: 2 } })
  })
})

function childReader(fixture: ReturnType<typeof certifiedPromotionFixture>) {
  return {
    ...applicationStorageWithoutCampaignGuard,
    read_child: async () => ({ kind: "ok" as const, state: fixture.child }),
  }
}
