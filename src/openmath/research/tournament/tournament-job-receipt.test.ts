import { expect, test } from "bun:test"

import { CampaignJobReceiptSchema } from "../state"

test("persists the normalized tournament result in terminal scheduler evidence", () => {
  // given
  const input = {
    kind: "TOURNAMENT",
    tournament_id: "tournament-01",
    result: {
      kind: "DECIDED",
      actions: [{ candidate_id: "direct-01", action: "KEEP" }],
      synthesis_brief: null,
      synthesis_brief_sha256: null,
    },
  }

  // when
  const parsed = CampaignJobReceiptSchema.safeParse(input)

  // then
  expect(parsed.success).toBe(true)
})
