import { describe, expect, test } from "bun:test"

import {
  extractNormalizedMarkdownArtifacts,
  extractNormalizedJsonPayload,
} from "./subagent-output-normalizer"

describe("subagent output normalizer contamination fixtures", () => {
  describe("XML tool_call contamination", () => {
    test("extracts markdown from XML tool_call block", () => {
      const contaminated = [
        '<tool_call name="Read" path="@file.md"/>',
        "<tool_call>",
        '{"tool":"Grep","pattern":"theorem"}',
        "</tool_call>",
        "",
        "<!-- OMO:SECTION reference_solution -->",
        "Solution content here",
        "<!-- OMO:ENDSECTION -->",
        "<|end_of_turn|>",
      ].join("\n")

      const normalized = extractNormalizedMarkdownArtifacts(contaminated)

      expect(normalized).not.toBeNull()
      expect(normalized).toContain("<!-- OMO:SECTION reference_solution -->")
      expect(normalized).toContain("Solution content here")
      expect(normalized).not.toContain("<tool_call")
    })

    test("extracts JSON from XML tool_call block", () => {
      const contaminated = [
        '<tool_call name="Read" path="@file.md"/>',
        '<tool_call>{"tool":"Grep"}</tool_call>',
        "",
        '{"verdict":"[CORRECT]","blocking_issues":[],"checks_performed":[],"certificate":{"artifact_version":"v1","review_round":1,"timestamp":"2024-01-01T00:00:00.000Z"},"base_hash":"xyz"}',
      ].join("\n")

      const normalized = extractNormalizedJsonPayload(contaminated)

      expect(normalized).not.toBeNull()
      expect(normalized).toContain('"verdict":"[CORRECT]"')
      expect(normalized).not.toContain("<tool_call")
    })
  })

  describe("self-closing tool tag contamination", () => {
    test("extracts markdown from self-closing tool tags", () => {
      const contaminated = [
        '<tool name="Read"/>',
        '<|end of text|>',
        '{"tool":"Grep"}<|end|>',
        "",
        "<!-- OMO:SECTION hint_ladder -->",
        "### L1_nudge",
        "hint text",
        "<!-- OMO:ENDSECTION -->",
      ].join("\n")

      const normalized = extractNormalizedMarkdownArtifacts(contaminated)

      expect(normalized).not.toBeNull()
      expect(normalized).toContain("<!-- OMO:SECTION hint_ladder -->")
      expect(normalized).not.toContain('<tool name="Read"/>')
    })

    test("extracts JSON after self-closing tool tags", () => {
      const contaminated = [
        '<tool type="Read"/><tool type="Grep"/>',
        "",
        '{"verdict":"[INCONCLUSIVE]","blocking_issues":[],"checks_performed":[],"certificate":{"artifact_version":"v1","review_round":1,"timestamp":"2024-01-01T00:00:00.000Z"},"base_hash":"abc"}',
      ].join("\n")

      const normalized = extractNormalizedJsonPayload(contaminated)

      expect(normalized).not.toBeNull()
      expect(normalized).toContain('"verdict":"[INCONCLUSIVE]"')
    })
  })

  describe("tool-JSON preamble contamination", () => {
    test("extracts markdown from tool-JSON preambles", () => {
      const contaminated = [
        '{"tool":"Read","path":"@theorem.md"}',
        '{"tool":"Grep","pattern":"\\section"}',
        '<|end of text|>',
        "",
        "<!-- OMO:SECTION grading_rubric -->",
        "### premises_check",
        "- check 1",
        "<!-- OMO:ENDSECTION -->",
      ].join("\n")

      const normalized = extractNormalizedMarkdownArtifacts(contaminated)

      expect(normalized).not.toBeNull()
      expect(normalized).toContain("<!-- OMO:SECTION grading_rubric -->")
      expect(normalized).not.toContain('{"tool":"Read"')
    })

    test("extracts JSON from tool-JSON preambles", () => {
      const contaminated = [
        '{"tool":"Read","path":"@solution.md"}',
        '{"tool":"Glob","pattern":"**/*.md"}<|end|>',
        "",
        '{"verdict":"[ERROR]","blocking_issues":[{"location":"step 2","type":"logic_error","fix_direction":"fix","evidence":"invalid"}],"checks_performed":["logic"],"certificate":{"artifact_version":"v1","review_round":2,"timestamp":"2024-01-01T00:00:00.000Z"},"base_hash":"def"}',
      ].join("\n")

      const normalized = extractNormalizedJsonPayload(contaminated)

      expect(normalized).not.toBeNull()
      expect(normalized).toContain('"verdict":"[ERROR]"')
      expect(normalized).not.toContain('{"tool":"Read"')
    })
  })

  describe("fenced code block contamination", () => {
    test("extracts markdown from fenced code blocks with tool output", () => {
      const contaminated = [
        "```",
        '{"tool":"Read","path":"@file.md"}',
        "```",
        "",
        "<!-- OMO:SECTION variant_problem -->",
        "Variant description",
        "<!-- OMO:ENDSECTION -->",
      ].join("\n")

      const normalized = extractNormalizedMarkdownArtifacts(contaminated)

      expect(normalized).not.toBeNull()
      expect(normalized).toContain("<!-- OMO:SECTION variant_problem -->")
    })

    test("extracts JSON from fenced code blocks", () => {
      const contaminated = [
        "```json",
        '{"tool":"Read","path":"@file.md"}',
        "```",
        "",
        '{"verdict":"[CORRECT]","blocking_issues":[],"checks_performed":[],"certificate":{"artifact_version":"v1","review_round":1,"timestamp":"2024-01-01T00:00:00.000Z"},"base_hash":"ghi"}',
      ].join("\n")

      const normalized = extractNormalizedJsonPayload(contaminated)

      expect(normalized).not.toBeNull()
      expect(normalized).toContain('"verdict":"[CORRECT]"')
    })

    test("handles nested fenced blocks with OMO sections", () => {
      const contaminated = [
        "```markdown",
        "<!-- OMO:SECTION reference_solution -->",
        "Some solution",
        "<!-- OMO:ENDSECTION -->",
        "```",
        "",
        "<!-- OMO:SECTION reference_solution -->",
        "Actual solution",
        "<!-- OMO:ENDSECTION -->",
      ].join("\n")

      const normalized = extractNormalizedMarkdownArtifacts(contaminated)

      expect(normalized).not.toBeNull()
      expect(normalized).toContain("Actual solution")
    })
  })
})
