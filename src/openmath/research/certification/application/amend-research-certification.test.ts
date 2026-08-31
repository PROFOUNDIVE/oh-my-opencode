import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import {
  removeTemporaryCampaignDirectory,
  temporaryCampaignDirectory,
} from "../../application/application-test-fixture"
import { applicationStorageWithoutCampaignGuard, certifiedPromotionFixture } from "./certification-application-test-fixture"
import { amendResearchCertification } from "./amend-research-certification"
import { initializeResearchCertification } from "./initialize-research-certification"

describe("certification amendments", () => {
  let directory: string

  beforeEach(() => {
    directory = temporaryCampaignDirectory()
  })

  afterEach(() => {
    removeTemporaryCampaignDirectory(directory)
  })

  test("persists one revision-checked certification amendment", async () => {
    // given
    const fixture = certifiedPromotionFixture()
    await initializeResearchCertification({
      directory,
      campaign_id: fixture.campaign.campaign_id,
      expected_state_revision: fixture.campaign.state_revision,
    }, readers(fixture))

    // when
    const result = await amendResearchCertification({
      directory,
      campaign_id: fixture.campaign.campaign_id,
      expected_state_revision: fixture.campaign.state_revision,
      expected_certification_revision: 0,
      operation: "add",
      kind: "required_check",
      scope: "graph",
      content: "Check the exact boundary case.",
    }, readers(fixture))

    // then
    expect(result).toMatchObject({
      kind: "ok",
      state: {
        certification_revision: 1,
        amendments: [{ event_type: "ADDED", scope: "graph", content: "Check the exact boundary case." }],
      },
    })
  })

  test("allows only one concurrent amendment at the expected certification revision", async () => {
    // given
    const fixture = certifiedPromotionFixture()
    await initializeResearchCertification({
      directory,
      campaign_id: fixture.campaign.campaign_id,
      expected_state_revision: fixture.campaign.state_revision,
    }, readers(fixture))
    const input = {
      directory,
      campaign_id: fixture.campaign.campaign_id,
      expected_state_revision: fixture.campaign.state_revision,
      expected_certification_revision: 0,
      operation: "add" as const,
      kind: "question" as const,
      scope: "coverage",
      content: "Review coverage.",
    }

    // when
    const results = await Promise.all([
      amendResearchCertification(input, readers(fixture)),
      amendResearchCertification(input, readers(fixture)),
    ])

    // then
    expect(results.filter((result) => result.kind === "ok")).toHaveLength(1)
    expect(results.filter((result) => result.kind === "error" && result.error_code === "STALE_CERTIFICATION_REVISION")).toHaveLength(1)
  })
})

function readers(fixture: ReturnType<typeof certifiedPromotionFixture>) {
  return {
    ...applicationStorageWithoutCampaignGuard,
    read_campaign: async () => ({ kind: "ok" as const, state: fixture.campaign }),
    read_child: async () => ({ kind: "ok" as const, state: fixture.child }),
  }
}
