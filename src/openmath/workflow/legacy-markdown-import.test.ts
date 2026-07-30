import { createHash } from "node:crypto"
import { describe, expect, test } from "bun:test"

import { formatOpenMathArtifactsMarkdown } from "../artifacts-markdown/format"
import { hashOpenMathArtifactsMarkdown } from "../artifacts-markdown/hash"
import { importLegacySolveOnlyState } from "./state"
import { HashSchema } from "./state/literals"
import { createWorkflowStateFixture, frozenArtifacts } from "./state/test-fixture"

function importMarkdownState(frozen: object) {
  const fixture = createWorkflowStateFixture()
  return importLegacySolveOnlyState({
    source_bytes: new TextEncoder().encode(JSON.stringify({
      session_id: "legacy::markdown-failed-review",
      artifact_state: "DRAFT",
      artifact_version: 1,
      review_round: 2,
      max_review_rounds: 3,
      hint_budget_state: { hints_used: 0, hint_budget: 3 },
      frozen_artifacts: frozen,
    })),
    parent_session_id: "parent",
    legacy_profile_name: "legacy-educational-markdown",
    invocation: "solve_only",
    profile_snapshot: fixture.profile_snapshot,
    reference_snapshot: fixture.reference_snapshot,
    existing_state: null,
  })
}

function retainedMarkdownArtifacts() {
  const artifacts = frozenArtifacts()
  artifacts.review_certificate.verdict = "[ERROR]"
  artifacts.review_certificate.review_round = 1
  const markdown = formatOpenMathArtifactsMarkdown({
    reference_solution: artifacts.reference_solution,
    hint_ladder: artifacts.hint_ladder,
    grading_rubric: artifacts.grading_rubric,
    variant_problem: artifacts.variant_problem,
  })
  const hash = hashOpenMathArtifactsMarkdown(markdown)
  const workflowHash = createHash("sha256").update(Buffer.from(markdown)).digest("hex")
  return {
    artifacts: {
      ...artifacts,
      hint_ladder: {
        ...artifacts.hint_ladder,
        __orchestrator_state: {
          artifacts_format: "markdown",
          artifacts_markdown: markdown,
          artifacts_hash: hash,
        },
      },
    },
    markdown,
    hash,
    workflowHash,
  }
}

describe("legacy markdown state import", () => {
  test("recovers exact retained markdown and hash for failed-review REVISE input", () => {
    // given
    const retained = retainedMarkdownArtifacts()

    // when
    const result = importMarkdownState(retained.artifacts)

    // then
    expect(result.kind).toBe("imported")
    if (result.kind !== "imported") return
    expect(result.state).toMatchObject({ next_stage: "REVISE", completed_review_rounds: 1 })
    expect(result.state.artifact).toEqual({
      version: 1,
      media_type: "text/markdown",
      content: retained.markdown,
      sha256: retained.workflowHash,
    })
  })

  test("fails closed for missing, malformed, or mismatched retained markdown metadata", () => {
    // given
    const retained = retainedMarkdownArtifacts()
    const missing = frozenArtifacts()
    const malformed = {
      ...retained.artifacts,
      hint_ladder: { ...retained.artifacts.hint_ladder, __orchestrator_state: { artifacts_format: "markdown", artifacts_markdown: 3, artifacts_hash: retained.hash } },
    }
    const mismatched = {
      ...retained.artifacts,
      hint_ladder: { ...retained.artifacts.hint_ladder, __orchestrator_state: { artifacts_format: "markdown", artifacts_markdown: retained.markdown, artifacts_hash: "e".repeat(43) } },
    }

    // when
    const results = [missing, malformed, mismatched].map(importMarkdownState)

    // then
    expect(results.every((result) => result.kind === "error" && result.error_code === "STORAGE_READ_FAILED")).toBe(true)
  })

  test("imports a base64url legacy markdown hash once while retaining a core hex artifact hash", () => {
    // given
    const retained = retainedMarkdownArtifacts()
    const legacyHash = hashOpenMathArtifactsMarkdown(retained.markdown)
    const artifacts = {
      ...retained.artifacts,
      hint_ladder: {
        ...retained.artifacts.hint_ladder,
        __orchestrator_state: {
          artifacts_format: "markdown",
          artifacts_markdown: retained.markdown,
          artifacts_hash: legacyHash,
          last_blocking_issues: [{ location: "reference_solution" }],
        },
      },
    }

    // when
    const imported = importMarkdownState(artifacts)
    const repeated = imported.kind === "imported"
      ? importLegacySolveOnlyState({
          source_bytes: new TextEncoder().encode(JSON.stringify({
            session_id: "legacy::markdown-failed-review",
            artifact_state: "DRAFT",
            artifact_version: 1,
            review_round: 2,
            max_review_rounds: 3,
            hint_budget_state: { hints_used: 0, hint_budget: 3 },
            frozen_artifacts: artifacts,
          })),
          parent_session_id: "parent",
          legacy_profile_name: "legacy-educational-markdown",
          invocation: "solve_only",
          profile_snapshot: imported.state.profile_snapshot,
          reference_snapshot: imported.state.reference_snapshot,
          existing_state: imported.state,
        })
      : imported

    // then
    expect(imported.kind).toBe("imported")
    if (imported.kind !== "imported") return
    expect(legacyHash).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(imported.state.artifact?.content).toBe(retained.markdown)
    expect(HashSchema.safeParse(imported.state.artifact?.sha256).success).toBe(true)
    expect(imported.state.artifact?.sha256).not.toBe(legacyHash)
    expect(repeated).toMatchObject({ kind: "skipped", message: "Legacy state was already imported" })
  })
})
