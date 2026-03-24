import { describe, expect, test } from "bun:test"

import { stripWrapperFenceLines } from "./output-fence-stripper"

describe("stripWrapperFenceLines", () => {
  test("removes wrapper fence lines outside OMO sections", () => {
    const input = [
      "```json",
      '{"tool":"Read"}',
      "```",
      "<!-- OMO:SECTION reference_solution -->",
      "Solution",
      "<!-- OMO:ENDSECTION -->",
    ].join("\n")

    const output = stripWrapperFenceLines(input)
    expect(output).not.toContain("```json")
    expect(output).not.toContain("\n```\n")
    expect(output).toContain('{"tool":"Read"}')
  })

  test("preserves fenced blocks inside OMO sections", () => {
    const input = [
      "<!-- OMO:SECTION reference_solution -->",
      "```",
      "x = 1",
      "```",
      "<!-- OMO:ENDSECTION -->",
    ].join("\n")

    const output = stripWrapperFenceLines(input)
    expect(output).toContain("```\nx = 1\n```")
  })
})
