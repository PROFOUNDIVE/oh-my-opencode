import { describe, expect, test } from "bun:test"

import {
  extractNormalizedMarkdownArtifacts,
  extractNormalizedJsonPayload,
} from "./subagent-output-normalizer"

describe("subagent output normalizer mixed prose fixtures", () => {
  describe("mixed prose contamination", () => {
    test("extracts markdown from mixed prose", () => {
      const contaminated = [
        "Let me analyze this problem...",
        '{"tool":"Read","path":"@book.md"}<|end|>',
        "First, I need to understand the theorem.",
        "",
        "<!-- OMO:SECTION reference_solution -->",
        "The proof begins by...",
        "<!-- OMO:ENDSECTION -->",
        "",
        "This completes the proof.",
      ].join("\n")

      const normalized = extractNormalizedMarkdownArtifacts(contaminated)

      expect(normalized).not.toBeNull()
      expect(normalized).toContain("<!-- OMO:SECTION reference_solution -->")
      expect(normalized).toContain("The proof begins by")
    })

    test("returns null when reviewer JSON is followed by trailing prose", () => {
      const contaminated = [
        "After reviewing the solution, I found an error.",
        '{"tool":"Read","path":"@solution.md"}<|end|>',
        "The logic in step 3 is flawed.",
        "",
        '{"verdict":"[ERROR]","blocking_issues":[{"location":"step 3","type":"logic_error","fix_direction":"fix","evidence":"circular reasoning"}],"checks_performed":["logic"],"certificate":{"artifact_version":"v1","review_round":1,"timestamp":"2024-01-01T00:00:00.000Z"},"base_hash":"jkl"}',
        "",
        "The rest of the solution looks correct.",
      ].join("\n")

      const normalized = extractNormalizedJsonPayload(contaminated)

      expect(normalized).toBeNull()
    })

    test("extracts markdown and returns null JSON when prose trails payload", () => {
      const contaminated = [
        "I'll solve this step by step.",
        '<tool_call>{"tool":"Read"}</tool_call>',
        '{"tool":"Grep"}<|end|>',
        "",
        "```",
        "Some intermediate output",
        "```",
        "",
        "<!-- OMO:SECTION reference_solution -->",
        "Final solution",
        "<!-- OMO:ENDSECTION -->",
        "<!-- OMO:SECTION hint_ladder -->",
        "### L1_nudge",
        "First hint",
        "<!-- OMO:ENDSECTION -->",
        "",
        "Let me verify this is correct...",
        '{"verdict":"[CORRECT]","blocking_issues":[],"checks_performed":[],"certificate":{"artifact_version":"v1","review_round":1,"timestamp":"2024-01-01T00:00:00.000Z"},"base_hash":"mno"}',
        "",
        "Verification complete.",
      ].join("\n")

      const markdown = extractNormalizedMarkdownArtifacts(contaminated)
      const json = extractNormalizedJsonPayload(contaminated)

      expect(markdown).not.toBeNull()
      expect(markdown).toContain("<!-- OMO:SECTION reference_solution -->")
      expect(markdown).toContain("<!-- OMO:SECTION hint_ladder -->")
      expect(json).toBeNull()
    })
  })

  describe("contaminated but recoverable outputs", () => {
    test("recovers from tool output interleaved with valid content", () => {
      const contaminated = [
        "<!-- OMO:SECTION reference_solution -->",
        "Step 1: Assume...",
        '{"tool":"Read","path":"@ref.md"}<|end|>',
        "Step 2: Therefore...",
        "<!-- OMO:ENDSECTION -->",
      ].join("\n")

      const normalized = extractNormalizedMarkdownArtifacts(contaminated)

      expect(normalized).not.toBeNull()
      expect(normalized).toContain("Step 1: Assume")
      expect(normalized).toContain("Step 2: Therefore")
      expect(normalized).not.toContain('{"tool":"Read"')
    })

    test("recovers from multiple end markers in content", () => {
      const contaminated = [
        '<|end of text|>',
        '{"tool":"Read"}<|end|>',
        '<|end_of_turn|>',
        "",
        '{"verdict":"[INCONCLUSIVE]","blocking_issues":[],"checks_performed":[],"certificate":{"artifact_version":"v1","review_round":1,"timestamp":"2024-01-01T00:00:00.000Z"},"base_hash":"pqr"}',
        "<|end_of_text|>",
      ].join("\n")

      const normalized = extractNormalizedJsonPayload(contaminated)

      expect(normalized).not.toBeNull()
      expect(normalized).toContain('"verdict":"[INCONCLUSIVE]"')
      expect(normalized).not.toContain("<|end")
    })

    test("handles nested JSON in tool output", () => {
      const contaminated = [
        '{"tool":"Read","path":"@complex.json","content":"{\\"nested\\": true}"}',
        '<|end|>',
        "",
        "<!-- OMO:SECTION reference_solution -->",
        "Solution with nested data",
        "<!-- OMO:ENDSECTION -->",
      ].join("\n")

      const normalized = extractNormalizedMarkdownArtifacts(contaminated)

      expect(normalized).not.toBeNull()
      expect(normalized).toContain("<!-- OMO:SECTION reference_solution -->")
    })

    test("handles array JSON after tool noise", () => {
      const contaminated = [
        '{"tool":"Grep","pattern":"test"}<|end|>',
        "",
        '[{"op":"replace","path":"/section","value":"new content"}]',
      ].join("\n")

      const normalized = extractNormalizedJsonPayload(contaminated)

      expect(normalized).not.toBeNull()
      expect(normalized).toContain('"op":"replace"')
      expect(normalized).not.toContain('{"tool":"Grep"')
    })
  })
})
