import { describe, expect, test } from "bun:test"
import { fetchSyncResult } from "./sync-result-fetcher"

describe("fetchSyncResult openmath boundary", () => {
  test("does not scrub generic delegate-task responses", async () => {
    const mockClient = {
      session: {
        messages: async () => ({
          data: [
            {
              info: { id: "msg_001", role: "assistant", time: { created: 1000 } },
              parts: [
                {
                  type: "text",
                  text: '{"tool":"Read","path":"@book/Merged_Differential_Geometry.md"}\n{"verdict":"[ERROR]"}<|end of text|>',
                },
              ],
            },
          ],
        }),
      },
    }

    const result = await fetchSyncResult(mockClient as any, "ses_test")

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.textContent).toContain('{"tool":"Read"')
      expect(result.textContent).toContain("<|end of text|>")
      expect(result.textContent).toContain('{"verdict":"[ERROR]"}')
    }
  })
})
