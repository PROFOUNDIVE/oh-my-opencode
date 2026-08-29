import { expect, test } from "bun:test"

import { ResearchCampaignStateV1Schema } from "./index"
import { createResearchCampaignStateFixture } from "./test-fixture"

test("rejects the intentional illegal cross-field failure probe", () => {
  // given
  const input = {
    ...createResearchCampaignStateFixture(),
    status: "AWAITING_HUMAN",
    awaiting_reason: "BEFORE_PROMOTION",
    attachment: {
      verification: { result: "VERIFIED" },
    },
  }

  // when
  const parsed = ResearchCampaignStateV1Schema.safeParse(input)

  // then
  expect(parsed.success).toBe(process.env.TASK_6_FAILURE_PROBE === "illegal-cross-field")
})
