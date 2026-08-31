import { describe, expect, test } from "bun:test"

import { certifiedPromotionFixture } from "../certification/application/certification-application-test-fixture"
import { readyCertificationState } from "../certification/state/certification-test-fixture"
import { ResearchCertificationStateV1Schema } from "../certification/state/schema"
import { buildCertificationGenerationIndex } from "../certification/storage/generation-index"
import { getResearchCampaignStatus } from "./get-research-campaign-status"
import { abortResearchCampaign } from "./abort-research-campaign"
import { amendResearchCampaign } from "./amend-research-campaign"

describe("enabled public lifecycle commands", () => {
  test("status reports NOT_STARTED using reads only", async () => {
    // given
    const fixture = certifiedPromotionFixture()
    let campaignReads = 0
    let childReads = 0
    let generationReads = 0
    let mutations = 0

    // when
    const result = await getResearchCampaignStatus({
      directory: "",
      campaign_id: fixture.campaign.campaign_id,
    }, {
      read_campaign: async () => {
        campaignReads += 1
        return { kind: "ok", state: fixture.campaign }
      },
      read_child: async () => {
        childReads += 1
        return { kind: "ok", state: fixture.child }
      },
      read_generation: async () => {
        generationReads += 1
        return { kind: "not_started" }
      },
      repair_generation_index: async () => {
        mutations += 1
        return { kind: "error", error_code: "STORAGE_WRITE_FAILED", message: "must not repair" }
      },
      compare_and_swap_generation: async () => {
        mutations += 1
        return { kind: "error", error_code: "STORAGE_WRITE_FAILED", message: "must not write" }
      },
    })

    // then
    expect(result).toMatchObject({ ok: true, certification: { status: "NOT_STARTED", certification_revision: null } })
    expect({ campaignReads, childReads, generationReads, mutations }).toEqual({
      campaignReads: 1,
      childReads: 1,
      generationReads: 1,
      mutations: 0,
    })
  })

  test("rejects enabled amendment before initialization", async () => {
    // given
    const fixture = certifiedPromotionFixture()
    let writes = 0

    // when
    const result = await amendResearchCampaign({
      directory: "",
      campaign_id: fixture.campaign.campaign_id,
      expected_state_revision: fixture.campaign.state_revision,
      expected_certification_revision: 0,
      operation: "add",
      kind: "question",
      scope: "graph",
      content: "Check the graph.",
    }, {
      read_campaign: async () => ({ kind: "ok", state: fixture.campaign }),
      read_child: async () => ({ kind: "ok", state: fixture.child }),
      read_generation: async () => ({ kind: "not_started" }),
      compare_and_swap_generation: async () => {
        writes += 1
        return { kind: "error", error_code: "STORAGE_WRITE_FAILED", message: "must not write" }
      },
    })

    // then
    expect(result).toMatchObject({ ok: false, error_code: "CERTIFICATION_NOT_FOUND" })
    expect(writes).toBe(0)
  })

  test("uses the enabled error envelope for stale amendment campaign revision", async () => {
    const fixture = certifiedPromotionFixture()

    const result = await amendResearchCampaign({
      directory: "",
      campaign_id: fixture.campaign.campaign_id,
      expected_state_revision: fixture.campaign.state_revision - 1,
      expected_certification_revision: 0,
      operation: "add",
      kind: "question",
      scope: "graph",
      content: "Check the graph.",
    }, {
      read_campaign: async () => ({ kind: "ok", state: fixture.campaign }),
    })

    expect(result).toEqual({
      ok: false,
      error_code: "STALE_STATE_REVISION",
      message: `Expected revision ${fixture.campaign.state_revision - 1}, found ${fixture.campaign.state_revision}`,
      current_state_revision: fixture.campaign.state_revision,
    })
  })

  test("commits anomaly abort and returns the authoritative public error", async () => {
    // given
    const fixture = certifiedPromotionFixture()
    let sidecarMutations = 0
    let abortedCampaign = fixture.campaign

    // when
    const result = await abortResearchCampaign({
      directory: "",
      campaign_id: fixture.campaign.campaign_id,
      expected_state_revision: fixture.campaign.state_revision,
      expected_certification_revision: null,
      reason: "stop",
    }, {
      read_campaign: async () => ({ kind: "ok", state: fixture.campaign }),
      read_generation: async () => ({
        kind: "error",
        error_code: "STORAGE_READ_FAILED",
        reason: "REVISION_WITHOUT_INDEX",
        message: "Certification revision exists without a generation index",
      }),
      compare_and_swap_campaign: async (request) => {
        abortedCampaign = request.next_state
        return { kind: "ok", state: request.next_state }
      },
      compare_and_swap_generation: async () => {
        sidecarMutations += 1
        return { kind: "error", error_code: "STORAGE_WRITE_FAILED", message: "must not write" }
      },
      repair_generation_index: async () => {
        sidecarMutations += 1
        return { kind: "error", error_code: "STORAGE_WRITE_FAILED", message: "must not repair" }
      },
    })
    const status = await getResearchCampaignStatus({ directory: "", campaign_id: fixture.campaign.campaign_id }, {
      read_campaign: async () => ({ kind: "ok", state: abortedCampaign }),
      read_child: async () => ({ kind: "ok", state: fixture.child }),
      read_generation: async () => ({
        kind: "error",
        error_code: "STORAGE_READ_FAILED",
        reason: "REVISION_WITHOUT_INDEX",
        message: "Certification revision exists without a generation index",
      }),
    })

    // then
    expect(result).toEqual({
      ok: false,
      error_code: "SIDECAR_CLEANUP_FAILED",
      message: "Certification revision exists without a generation index",
      current_state_revision: fixture.campaign.state_revision + 1,
      campaign_aborted: true,
    })
    expect(sidecarMutations).toBe(0)
    expect(status).toMatchObject({
      ok: true,
      status: "ABORTED",
      certification: { status: "STORAGE_ANOMALY", effective_status: "ABORTED", next_actions: [] },
    })
  })

  test("loses a delayed amendment when a callback wins certification CAS", async () => {
    // given
    const fixture = certifiedPromotionFixture()
    const state = ResearchCertificationStateV1Schema.parse(readyCertificationState())
    let campaignWrites = 0

    // when
    const result = await amendResearchCampaign({
      directory: "",
      campaign_id: fixture.campaign.campaign_id,
      expected_state_revision: fixture.campaign.state_revision,
      expected_certification_revision: 0,
      operation: "add",
      kind: "question",
      scope: "coverage",
      content: "Recheck coverage.",
    }, {
      read_campaign: async () => ({ kind: "ok", state: fixture.campaign }),
      read_child: async () => ({ kind: "ok", state: fixture.child }),
      read_generation: async () => ({
        kind: "ok",
        state,
        index: buildCertificationGenerationIndex(state, fixture.campaign.state_revision),
        content_sha256: "a".repeat(64),
        index_content_sha256: "b".repeat(64),
      }),
      compare_and_swap_generation: async () => ({
        kind: "error",
        error_code: "STALE_CERTIFICATION_REVISION",
        current_certification_revision: 1,
        message: "Expected certification revision 0, found 1",
      }),
      compare_and_swap: async () => {
        campaignWrites += 1
        return { kind: "error", error_code: "STORAGE_WRITE_FAILED", message: "must not write campaign" }
      },
    })

    // then
    expect(result).toEqual({
      ok: false,
      error_code: "STALE_CERTIFICATION_REVISION",
      message: "Expected certification revision 0, found 1",
      current_certification_revision: 1,
    })
    expect(campaignWrites).toBe(0)
  })
})
