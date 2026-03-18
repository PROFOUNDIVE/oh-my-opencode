import { describe, expect, test } from "bun:test"

import {
  extractNormalizedMarkdownArtifacts,
  extractNormalizedJsonPayload,
} from "./subagent-output-normalizer"

describe("subagent output normalizer", () => {
  test("extracts markdown artifacts block after tool-call noise", () => {
    const noisy = [
      '{"tool":"Read","path":"@book/Merged_Differential_Geometry.md"}',
      '{"tool":"Grep","pattern":"principal patch"}<|end of text|>',
      "",
      "<!-- OMO:SECTION reference_solution -->",
      "Proof sketch",
      "<!-- OMO:ENDSECTION -->",
      "<!-- OMO:SECTION hint_ladder -->",
      "### L1_nudge",
      "n",
      "### L2_key_theorem",
      "t",
      "### L3_skeleton",
      "- s1",
      "### L4_full_solution",
      "@REFERENCE_SOLUTION",
      "<!-- OMO:ENDSECTION -->",
      "<!-- OMO:SECTION grading_rubric -->",
      "### premises_check",
      "- p",
      "### logical_steps",
      "- l",
      "### common_pitfalls",
      "- c",
      "### key_theorem",
      "k",
      "### key_technique",
      "m",
      "<!-- OMO:ENDSECTION -->",
      "<!-- OMO:SECTION variant_problem -->",
      "v",
      "<!-- OMO:ENDSECTION -->",
      "<|end_of_turn|>",
    ].join("\n")

    const normalized = extractNormalizedMarkdownArtifacts(noisy)

    expect(normalized).not.toBeNull()
    expect(normalized!.startsWith("<!-- OMO:SECTION reference_solution -->")).toBe(true)
    expect(normalized!.includes('{"tool":"Read"')).toBe(false)
    expect(normalized!.includes("<|end")).toBe(false)
  })

  test("extracts final reviewer JSON payload after tool-call noise", () => {
    const noisy = [
      '{"tool":"Read","path":"@book/Merged_Differential_Geometry.md"}',
      '{"tool":"Glob","pattern":"**/Merged_Differential_Geometry.md"}<|end of text|>',
      "random prose",
      '{"verdict":"[ERROR]","blocking_issues":[{"location":"reference_solution:step 1","type":"logic_error","fix_direction":"fix","evidence":"e"}],"checks_performed":["logic"],"certificate":{"artifact_version":"v1","review_round":2,"timestamp":"1970-01-01T00:00:00.000Z"},"base_hash":"abc"}',
    ].join("\n")

    const normalized = extractNormalizedJsonPayload(noisy)

    expect(normalized).not.toBeNull()
    expect(normalized).toContain('"verdict":"[ERROR]"')
    expect(normalized).not.toContain('{"tool":"Read"')
    expect(normalized).not.toContain("<|end")
  })

  test("returns null when no canonical payload can be recovered", () => {
    const noisy = [
      "tool output",
      '<|end of text|>',
      "narration only",
    ].join("\n")

    expect(extractNormalizedMarkdownArtifacts(noisy)).toBeNull()
    expect(extractNormalizedJsonPayload(noisy)).toBeNull()
  })
})
