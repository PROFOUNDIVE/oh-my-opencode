import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import {
  removeTemporaryCampaignDirectory,
  temporaryCampaignDirectory,
} from "../../application/application-test-fixture"
import { applicationStorageWithoutCampaignGuard, certifiedPromotionFixture } from "./certification-application-test-fixture"
import { stepResearchCertification } from "./step-research-certification"

describe("certification step stale revision handling", () => {
  let directory: string

  beforeEach(() => {
    directory = temporaryCampaignDirectory()
  })

  afterEach(() => {
    removeTemporaryCampaignDirectory(directory)
  })

  test("rejects a stale campaign revision before repairing an orphan", async () => {
    // given
    const fixture = certifiedPromotionFixture()
    let repairs = 0

    // when
    const result = await stepResearchCertification({
      directory,
      campaign_id: fixture.campaign.campaign_id,
      expected_state_revision: fixture.campaign.state_revision - 1,
      expected_certification_revision: null,
      mode: "one_stage",
    }, {
      ...readers(fixture),
      read_generation: async () => ({
        kind: "error",
        error_code: "STORAGE_READ_FAILED",
        reason: "REVISION_WITHOUT_INDEX",
        message: "orphan",
      }),
      repair_generation_index: async () => {
        repairs += 1
        return { kind: "error", error_code: "STORAGE_WRITE_FAILED", message: "must not repair" }
      },
      plan_operation: () => { throw new TypeError("stale step must not plan") },
      run_operation: async () => { throw new TypeError("stale step must not run") },
    })

    // then
    expect(result).toMatchObject({ kind: "error", error_code: "STALE_STATE_REVISION" })
    expect(repairs).toBe(0)
  })
})

function readers(fixture: ReturnType<typeof certifiedPromotionFixture>) {
  return {
    ...applicationStorageWithoutCampaignGuard,
    read_campaign: async () => ({ kind: "ok" as const, state: fixture.campaign }),
    read_child: async () => ({ kind: "ok" as const, state: fixture.child }),
  }
}
