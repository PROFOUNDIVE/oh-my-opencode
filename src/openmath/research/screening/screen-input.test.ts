import { describe, expect, test } from "bun:test"

import type { ReferenceSnapshot } from "../../references/types"
import type { WorkflowRequestSnapshot } from "../../workflow/state"
import { buildBlindScreenInput } from "./screen-input"

const HASH = "a".repeat(64)

describe("blind screen input", () => {
  test("projects exactly common content, one target artifact, and screening instructions", () => {
    // given
    const objective: WorkflowRequestSnapshot = {
      kind: "problem",
      source: {
        kind: "file",
        file_path: "OBJECTIVE_SOURCE_PATH_SENTINEL",
        problem_number: 7,
        resolved_path: "OBJECTIVE_RESOLVED_PATH_SENTINEL",
      },
      problem_text: "Prove the target theorem.",
      subject: "Topology",
      chapter_context: "Compactness chapter.",
      textbook_markdown: "Common textbook excerpt.",
      supplementary_refs: ["Common supplementary note."],
    }
    const references = referenceSnapshot()
    const targetArtifact = targetArtifactWithForbiddenMetadata()

    // when
    const screenInput = buildBlindScreenInput({
      objective,
      references,
      target_artifact: targetArtifact,
      screening_instructions: "Assess the target artifact independently.",
    })

    // then
    expect(Object.keys(screenInput)).toEqual([
      "objective",
      "reference_contents",
      "target_artifact",
      "screening_instructions",
    ])
    expect(Object.keys(screenInput.objective)).toEqual([
      "kind",
      "problem_text",
      "subject",
      "chapter_context",
      "textbook_markdown",
      "supplementary_refs",
    ])
    expect(Object.keys(screenInput.target_artifact)).toEqual(["content"])
    expect(screenInput.reference_contents).toEqual(["Common reference content."])
    expect(screenInput.target_artifact.content).toBe("TARGET_ARTIFACT_CONTENT")
    expect(screenInput.screening_instructions).toBe("Assess the target artifact independently.")
  })

  test("serializes no forbidden metadata keys or nested provenance values", () => {
    // given
    const input = {
      objective: markdownObjectiveWithForbiddenMetadata(),
      references: referenceSnapshot(),
      target_artifact: targetArtifactWithForbiddenMetadata(),
      screening_instructions: "Screen only this artifact.",
      candidate_id: "TOP_LEVEL_CANDIDATE_SENTINEL",
      parent_candidate_ids: ["TOP_LEVEL_PARENT_SENTINEL"],
      strategy: "TOP_LEVEL_STRATEGY_SENTINEL",
      model: "TOP_LEVEL_MODEL_SENTINEL",
      provider: "TOP_LEVEL_PROVIDER_SENTINEL",
      prompt_provenance: "TOP_LEVEL_PROMPT_SENTINEL",
      session_id: "TOP_LEVEL_SESSION_SENTINEL",
      timestamp: "TOP_LEVEL_TIMESTAMP_SENTINEL",
      raw_output_sha256: "TOP_LEVEL_RAW_HASH_SENTINEL",
      lineage: "TOP_LEVEL_LINEAGE_SENTINEL",
      sibling_material: "TOP_LEVEL_SIBLING_SENTINEL",
    }

    // when
    const screenInput = buildBlindScreenInput(input)
    const serialized = JSON.stringify(screenInput)

    // then
    const forbiddenKeys = [
      "candidate_id", "parent_candidate_ids", "strategy_id", "strategy",
      "providerID", "modelID", "provider", "model", "prompt", "prompt_provenance",
      "session_id", "reviewer_session_id", "timestamp", "sha256", "raw_output_sha256",
      "lineage", "sibling_material", "child_run_id", "child_state_revision",
      "artifact_version", "state_revision", "input_sha256", "output_hash", "attachments",
    ]
    const serializedValues = [
      "TOP_LEVEL_CANDIDATE_SENTINEL",
      "TOP_LEVEL_PARENT_SENTINEL",
      "TOP_LEVEL_STRATEGY_SENTINEL",
      "TOP_LEVEL_MODEL_SENTINEL",
      "TOP_LEVEL_PROVIDER_SENTINEL",
      "TOP_LEVEL_PROMPT_SENTINEL",
      "TOP_LEVEL_SESSION_SENTINEL",
      "TOP_LEVEL_TIMESTAMP_SENTINEL",
      "TOP_LEVEL_RAW_HASH_SENTINEL",
      "TOP_LEVEL_LINEAGE_SENTINEL",
      "TOP_LEVEL_SIBLING_SENTINEL",
      "NESTED_CANDIDATE_SENTINEL",
      "NESTED_PARENT_SENTINEL",
      "NESTED_STRATEGY_SENTINEL",
      "NESTED_MODEL_SENTINEL",
      "NESTED_PROVIDER_SENTINEL",
      "NESTED_PROMPT_SENTINEL",
      "NESTED_SESSION_SENTINEL",
      "NESTED_TIMESTAMP_SENTINEL",
      "NESTED_HASH_SENTINEL",
      "NESTED_LINEAGE_SENTINEL",
      "NESTED_SIBLING_SENTINEL",
      "REFERENCE_PATH_SENTINEL",
      "REFERENCE_ID_SENTINEL",
    ]
    for (const key of forbiddenKeys) expect(serialized).not.toContain(`\"${key}\"`)
    for (const value of serializedValues) expect(serialized).not.toContain(value)
  })

  test("never includes a sibling candidate sentinel", () => {
    // given
    const input = {
      objective: { kind: "markdown" as const, instruction: "COMMON_OBJECTIVE" },
      references: referenceSnapshot(),
      target_artifact: targetArtifactWithForbiddenMetadata(),
      screening_instructions: "COMMON_SCREEN_INSTRUCTIONS",
      sibling_artifact: { content: "CANDIDATE_B_ARTIFACT_SENTINEL" },
      sibling_output: "CANDIDATE_B_OUTPUT_SENTINEL",
      sibling_screen: "CANDIDATE_B_SCREEN_SENTINEL",
    }

    // when
    const serialized = JSON.stringify(buildBlindScreenInput(input))

    // then
    expect(serialized).toContain("TARGET_ARTIFACT_CONTENT")
    expect(serialized).not.toContain("CANDIDATE_B_ARTIFACT_SENTINEL")
    expect(serialized).not.toContain("CANDIDATE_B_OUTPUT_SENTINEL")
    expect(serialized).not.toContain("CANDIDATE_B_SCREEN_SENTINEL")
  })
})

function referenceSnapshot(): ReferenceSnapshot {
  return {
    version: 1,
    manifest: { kind: "legacy_supplementary" },
    references: [{
      id: "REFERENCE_ID_SENTINEL",
      role: "authoritative",
      stages: ["review"],
      required: true,
      content: "Common reference content.",
      sha256: HASH,
      source: { kind: "inline", path: "REFERENCE_PATH_SENTINEL" },
    }],
    diagnostics: [],
    sha256: HASH,
  }
}

function markdownObjectiveWithForbiddenMetadata() {
  return {
    kind: "markdown" as const,
    instruction: "COMMON_OBJECTIVE",
    candidate_id: "NESTED_CANDIDATE_SENTINEL",
    parent_candidate_ids: ["NESTED_PARENT_SENTINEL"],
    strategy_id: "NESTED_STRATEGY_SENTINEL",
    modelID: "NESTED_MODEL_SENTINEL",
    providerID: "NESTED_PROVIDER_SENTINEL",
    prompt: "NESTED_PROMPT_SENTINEL",
    session_id: "NESTED_SESSION_SENTINEL",
    timestamp: "NESTED_TIMESTAMP_SENTINEL",
    sha256: "NESTED_HASH_SENTINEL",
    lineage: "NESTED_LINEAGE_SENTINEL",
    sibling_material: "NESTED_SIBLING_SENTINEL",
  }
}

function targetArtifactWithForbiddenMetadata() {
  return {
    version: 3,
    media_type: "text/markdown" as const,
    content: "TARGET_ARTIFACT_CONTENT",
    sha256: HASH,
    candidate_id: "NESTED_CANDIDATE_SENTINEL",
    child_run_id: "NESTED_CHILD_RUN_SENTINEL",
    strategy: "NESTED_STRATEGY_SENTINEL",
    model: "NESTED_MODEL_SENTINEL",
    provider: "NESTED_PROVIDER_SENTINEL",
    prompt_provenance: "NESTED_PROMPT_SENTINEL",
    reviewer_session_id: "NESTED_SESSION_SENTINEL",
    timestamp: "NESTED_TIMESTAMP_SENTINEL",
    raw_output_sha256: "NESTED_HASH_SENTINEL",
    lineage: "NESTED_LINEAGE_SENTINEL",
    sibling_material: "NESTED_SIBLING_SENTINEL",
  }
}
