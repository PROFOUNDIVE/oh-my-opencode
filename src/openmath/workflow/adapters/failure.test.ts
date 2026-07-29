import { describe, expect, test } from "bun:test"

import { adaptWorkflowOutput } from "./adapter-dispatch"

describe("adaptWorkflowOutput failures", () => {
  test("retains blank opaque markdown exactly", () => {
    const rawOutput = " \r\n\t\r"

    const result = adaptWorkflowOutput({ adapter: "opaque_markdown", raw_output: rawOutput })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected empty markdown error")
    expect(result.error).toMatchObject({ code: "EMPTY_MARKDOWN", raw_output: rawOutput })
  })

  test("retains blank full replacement markdown exactly", () => {
    const rawOutput = "\r\n\r\n"

    const result = adaptWorkflowOutput({ adapter: "full_replace_markdown", raw_output: rawOutput })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected empty replacement error")
    expect(result.error).toMatchObject({ code: "EMPTY_MARKDOWN", raw_output: rawOutput })
  })

  test("rejects a markdown review with no exact verdict declaration", () => {
    const rawOutput = "VERDICT: PASS because it is complete"

    const result = adaptWorkflowOutput({ adapter: "review_verdict_markdown", raw_output: rawOutput })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected missing verdict error")
    expect(result.error).toMatchObject({ code: "MISSING_VERDICT", raw_output: rawOutput })
  })

  test("rejects duplicate markdown verdict declarations", () => {
    const rawOutput = "VERDICT: PASS\nVERDICT: PASS"

    const result = adaptWorkflowOutput({ adapter: "review_verdict_markdown", raw_output: rawOutput })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected duplicate verdict error")
    expect(result.error).toMatchObject({ code: "DUPLICATE_VERDICT", raw_output: rawOutput })
  })

  test("rejects conflicting markdown verdict declarations", () => {
    const rawOutput = "VERDICT: PASS\nVERDICT: REVISE"

    const result = adaptWorkflowOutput({ adapter: "review_verdict_markdown", raw_output: rawOutput })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected conflicting verdict error")
    expect(result.error).toMatchObject({ code: "CONFLICTING_VERDICTS", raw_output: rawOutput })
  })

  test("retains malformed legacy JSON output", () => {
    const rawOutput = "{not valid JSON}"

    const result = adaptWorkflowOutput({ adapter: "legacy_json_artifacts", raw_output: rawOutput })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected JSON parse error")
    expect(result.error).toMatchObject({ code: "INVALID_JSON", raw_output: rawOutput })
  })

  test("retains malformed patch output", () => {
    const rawOutput = '{"base_hash":"hash","ops":[{"op":"unknown"}]}'

    const result = adaptWorkflowOutput({
      adapter: "patch_set_json",
      raw_output: rawOutput,
      base_markdown: "base",
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected invalid patch error")
    expect(result.error).toMatchObject({ code: "INVALID_PATCH_SET", raw_output: rawOutput })
  })
})
