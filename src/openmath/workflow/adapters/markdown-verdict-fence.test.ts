import { describe, expect, test } from "bun:test"

import { adaptWorkflowOutput } from "./adapter-dispatch"

describe("markdown review verdict fences", () => {
  test("rejects a verdict declared only in a fenced markdown example", () => {
    const rawOutput = "```markdown\nVERDICT: PASS\n```"

    const result = adaptWorkflowOutput({ adapter: "review_verdict_markdown", raw_output: rawOutput })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected missing operative verdict")
    expect(result.error).toMatchObject({ code: "MISSING_VERDICT", raw_output: rawOutput })
  })

  test("uses the one unfenced verdict after backtick and tilde examples", () => {
    const rawOutput = [
      "```markdown",
      "VERDICT: PASS",
      "```",
      "~~~text",
      "VERDICT: REVISE",
      "~~~",
      "VERDICT: INCONCLUSIVE",
    ].join("\n")

    const result = adaptWorkflowOutput({ adapter: "review_verdict_markdown", raw_output: rawOutput })

    expect(result.ok).toBe(true)
    if (!result.ok || result.adapter !== "review_verdict_markdown") {
      throw new Error("expected one operative verdict")
    }
    expect(result.review.verdict).toBe("INCONCLUSIVE")
  })
})
