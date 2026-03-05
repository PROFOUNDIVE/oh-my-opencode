/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import type { ToolContext } from "@opencode-ai/plugin/tool"

import { formatOpenMathArtifactsMarkdown } from "../../openmath/artifacts-markdown/format"
import { hashOpenMathArtifactsMarkdown } from "../../openmath/artifacts-markdown/hash"
import { createOpenMathArtifactsTools } from "./tools"

const mockContext = {
  sessionID: "test-session",
  messageID: "test-message",
  agent: "test-agent",
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
} as unknown as ToolContext

describe("openmath-artifacts tools", () => {
  test("openmath_artifacts_parse returns normalized markdown + base hash + draft", async () => {
    const tools = createOpenMathArtifactsTools()
    const markdown = formatOpenMathArtifactsMarkdown({
      reference_solution: "Let x = 1.",
      hint_ladder: {
        L1_nudge: "n",
        L2_key_theorem: "t",
        L3_skeleton: ["x"],
        L4_full_solution: "@REFERENCE_SOLUTION",
      },
      grading_rubric: {
        premises_check: ["a"],
        logical_steps: ["b"],
        common_pitfalls: ["c"],
        key_theorem: "k",
        key_technique: "m",
      },
      variant_problem: "v",
    })

    const outRaw = await tools.openmath_artifacts_parse.execute({ markdown }, mockContext)
    const out = JSON.parse(outRaw as string)
    expect(out.normalized_markdown).toBe(markdown)
    expect(out.base_hash).toBe(hashOpenMathArtifactsMarkdown(markdown))
    expect(out.draft.reference_solution).toBe("Let x = 1.")
  })

  test("openmath_artifacts_apply_patch returns stable error codes", async () => {
    const tools = createOpenMathArtifactsTools({ max_ops: 20, allow_unique_substring_replace: true })
    const markdown = formatOpenMathArtifactsMarkdown({
      reference_solution: "Let x = 1.",
      hint_ladder: {
        L1_nudge: "n",
        L2_key_theorem: "t",
        L3_skeleton: ["x"],
        L4_full_solution: "@REFERENCE_SOLUTION",
      },
      grading_rubric: {
        premises_check: ["a"],
        logical_steps: ["b"],
        common_pitfalls: ["c"],
        key_theorem: "k",
        key_technique: "m",
      },
      variant_problem: "v",
    })

    const outRaw = await tools.openmath_artifacts_apply_patch.execute(
      {
      base_markdown: markdown,
      patch_set: { base_hash: "wrong", ops: [] },
      },
      mockContext,
    )
    const out = JSON.parse(outRaw as string)
    expect(out.error_code).toBe("BASE_HASH_MISMATCH")
  })
})
