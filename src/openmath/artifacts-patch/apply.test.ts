import { describe, expect, test } from "bun:test"

import { formatOpenMathArtifactsMarkdown } from "../artifacts-markdown/format"
import { hashOpenMathArtifactsMarkdown } from "../artifacts-markdown/hash"
import { applyOpenMathArtifactsPatch } from "./apply"
import type { OpenMathArtifactsPatchSet } from "./types"

function makeBaseMarkdown(): string {
  return formatOpenMathArtifactsMarkdown({
    reference_solution: "Let UNIQUE_PHRASE_0123456789abcdef be the target.",
    hint_ladder: {
      L1_nudge: "Try to identify the key invariant.",
      L2_key_theorem: "Use the pigeonhole principle.",
      L3_skeleton: ["Define the objects.", "Apply the theorem.", "Conclude."],
      L4_full_solution: "@REFERENCE_SOLUTION",
    },
    grading_rubric: {
      premises_check: ["All variables are defined."],
      logical_steps: ["Argument is complete."],
      common_pitfalls: ["Missing a key case."],
      key_theorem: "Pigeonhole principle",
      key_technique: "Invariant tracking",
    },
    variant_problem: "Modify the conditions slightly and repeat the proof.",
  })
}

describe("applyOpenMathArtifactsPatch", () => {
  test("rejects base hash mismatch (fail closed)", () => {
    const base = makeBaseMarkdown()
    const patch: OpenMathArtifactsPatchSet = {
      base_hash: "not-the-right-hash",
      ops: [],
    }

    const result = applyOpenMathArtifactsPatch({ base_markdown: base, patch_set: patch })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error_code).toBe("BASE_HASH_MISMATCH")
  })

  test("enforces max ops limit", () => {
    const base = makeBaseMarkdown()
    const baseHash = hashOpenMathArtifactsMarkdown(base)
    const patch: OpenMathArtifactsPatchSet = {
      base_hash: baseHash,
      ops: Array.from({ length: 21 }, () => ({
        op: "replace_section" as const,
        section_id: "variant_problem" as const,
        new_content: "ok",
      })),
    }

    const result = applyOpenMathArtifactsPatch({ base_markdown: base, patch_set: patch })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error_code).toBe("TOO_MANY_OPS")
  })

  test("applies replace_section deterministically", () => {
    const base = makeBaseMarkdown()
    const baseHash = hashOpenMathArtifactsMarkdown(base)
    const patch: OpenMathArtifactsPatchSet = {
      base_hash: baseHash,
      ops: [
        {
          op: "replace_section",
          section_id: "variant_problem",
          new_content: "New variant statement with UNIQUE_VARIANT_0123456789abcdef.",
        },
      ],
    }

    const r1 = applyOpenMathArtifactsPatch({ base_markdown: base, patch_set: patch })
    const r2 = applyOpenMathArtifactsPatch({ base_markdown: base, patch_set: patch })
    expect(r1).toEqual(r2)
    expect(r1.ok).toBe(true)
    if (r1.ok) {
      expect(r1.draft.variant_problem).toContain("UNIQUE_VARIANT_0123456789abcdef")
      expect(r1.hash).toBe(hashOpenMathArtifactsMarkdown(r1.markdown))
    }
  })

  test("rejects replace_unique_substring when substring is missing", () => {
    const base = makeBaseMarkdown()
    const baseHash = hashOpenMathArtifactsMarkdown(base)
    const patch: OpenMathArtifactsPatchSet = {
      base_hash: baseHash,
      ops: [
        {
          op: "replace_unique_substring",
          section_id: "reference_solution",
          old: "MISSING_SUBSTRING_0123456789abcdef",
          new: "replacement",
        },
      ],
    }

    const result = applyOpenMathArtifactsPatch({ base_markdown: base, patch_set: patch })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error_code).toBe("UNIQUE_SUBSTRING_NOT_FOUND")
  })

  test("rejects replace_unique_substring when it matches more than once", () => {
    const base = formatOpenMathArtifactsMarkdown({
      reference_solution:
        "Here DOUBLE_MATCH_0123456789abcdef appears. And again DOUBLE_MATCH_0123456789abcdef appears.",
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

    const baseHash = hashOpenMathArtifactsMarkdown(base)
    const patch: OpenMathArtifactsPatchSet = {
      base_hash: baseHash,
      ops: [
        {
          op: "replace_unique_substring",
          section_id: "reference_solution",
          old: "DOUBLE_MATCH_0123456789abcdef",
          new: "REPLACED",
        },
      ],
    }

    const result = applyOpenMathArtifactsPatch({ base_markdown: base, patch_set: patch })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error_code).toBe("UNIQUE_SUBSTRING_NOT_UNIQUE")
  })

  test("applies replace_unique_substring inside a specific section", () => {
    const base = makeBaseMarkdown()
    const baseHash = hashOpenMathArtifactsMarkdown(base)
    const patch: OpenMathArtifactsPatchSet = {
      base_hash: baseHash,
      ops: [
        {
          op: "replace_unique_substring",
          section_id: "reference_solution",
          old: "UNIQUE_PHRASE_0123456789abcdef",
          new: "REPLACED_PHRASE_0123456789abcdef",
        },
      ],
    }

    const result = applyOpenMathArtifactsPatch({ base_markdown: base, patch_set: patch })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.draft.reference_solution).toContain("REPLACED_PHRASE_0123456789abcdef")
      expect(result.draft.reference_solution).not.toContain("UNIQUE_PHRASE_0123456789abcdef")
    }
  })

  test("can disable replace_unique_substring via opts", () => {
    const base = makeBaseMarkdown()
    const baseHash = hashOpenMathArtifactsMarkdown(base)
    const patch: OpenMathArtifactsPatchSet = {
      base_hash: baseHash,
      ops: [
        {
          op: "replace_unique_substring",
          section_id: "reference_solution",
          old: "UNIQUE_PHRASE_0123456789abcdef",
          new: "REPLACED_PHRASE_0123456789abcdef",
        },
      ],
    }

    const result = applyOpenMathArtifactsPatch({
      base_markdown: base,
      patch_set: patch,
      opts: { allow_unique_substring_replace: false },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error_code).toBe("UNIQUE_SUBSTRING_DISABLED")
  })

  test("fails closed when patched markdown becomes unparsable", () => {
    const base = makeBaseMarkdown()
    const baseHash = hashOpenMathArtifactsMarkdown(base)
    const patch: OpenMathArtifactsPatchSet = {
      base_hash: baseHash,
      ops: [
        {
          op: "replace_section",
          section_id: "reference_solution",
          new_content: "",
        },
      ],
    }

    const result = applyOpenMathArtifactsPatch({ base_markdown: base, patch_set: patch })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error_code).toBe("ARTIFACTS_PARSE_ERROR")
  })
})
