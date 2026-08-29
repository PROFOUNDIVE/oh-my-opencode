import { expect, test } from "bun:test"

import { reduceCampaignTransition } from "./index"
import { stateFor } from "./transition-test-fixture"

test("Task 7 intentional terminal-mutation probe", () => {
  // given
  const terminal = stateFor("PROMOTION", "PROMOTION_READY")

  // when
  const result = reduceCampaignTransition(terminal, {
    type: "ABORT",
    reason: "must not mutate a terminal campaign",
  })

  // then
  if (process.env.TASK_7_FAILURE_PROBE === "terminal-mutation") {
    expect(result.ok).toBe(true)
    return
  }
  expect(result).toMatchObject({ ok: false, error_code: "ILLEGAL_TRANSITION", state: terminal })
})
