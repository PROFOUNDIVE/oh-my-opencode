import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { removeTemporaryCampaignDirectory, temporaryCampaignDirectory } from "../../application/application-test-fixture"
import { startResearchCampaignState, compareAndSwapResearchCampaignState } from "../../storage"
import { reduceCampaignTransition } from "../../transitions"
import { emptyDiscoveryState } from "../../transitions/transition-test-fixture"
import { compareAndSwapCertificationGeneration } from "./compare-and-swap"
import { initializeCertificationGeneration } from "./initialization-reservation"
import { createCertificationStorageState } from "./storage-test-fixture"

describe("certification campaign guard", () => {
  let directory: string

  beforeEach(() => {
    directory = temporaryCampaignDirectory()
  })

  afterEach(() => {
    removeTemporaryCampaignDirectory(directory)
  })

  test("rejects stale initialization and sidecar writes after campaign abort", async () => {
    // given
    const campaign = emptyDiscoveryState()
    await startResearchCampaignState({ directory, state: campaign })
    const certification = createCertificationStorageState(campaign.campaign_id)
    const identity = {
      campaign_id: certification.campaign_id,
      selected_artifact: certification.selected_artifact,
      certification_profile_sha256: certification.certification_profile_sha256,
      initialized_from_campaign_revision: campaign.state_revision,
    }

    // when
    const stale = await initializeCertificationGeneration({
      directory,
      state: certification,
      initialized_from_campaign_revision: campaign.state_revision,
      campaign_guard: { expected_state_revision: campaign.state_revision + 1, expected_status: campaign.status },
    })
    const initialized = await initializeCertificationGeneration({
      directory,
      state: certification,
      initialized_from_campaign_revision: campaign.state_revision,
      campaign_guard: { expected_state_revision: campaign.state_revision, expected_status: campaign.status },
    })
    const aborted = reduceCampaignTransition(campaign, { type: "ABORT", reason: "stop" })
    if (!aborted.ok) throw new TypeError(aborted.message)
    const campaignWrite = await compareAndSwapResearchCampaignState({
      directory,
      campaign_id: campaign.campaign_id,
      expected_state_revision: campaign.state_revision,
      next_state: aborted.state,
    })
    if (campaignWrite.kind !== "ok") throw new TypeError(campaignWrite.message)
    const late = await compareAndSwapCertificationGeneration({
      directory,
      identity,
      expected_certification_revision: 0,
      next_state: certification,
      campaign_guard: { expected_state_revision: campaignWrite.state.state_revision, expected_status: "READY" },
    })

    // then
    expect(stale).toMatchObject({ kind: "error", error_code: "STALE_STATE_REVISION" })
    expect(initialized).toMatchObject({ kind: "ok" })
    expect(late).toMatchObject({ kind: "error", error_code: "CAMPAIGN_ABORTED" })
  })
})
