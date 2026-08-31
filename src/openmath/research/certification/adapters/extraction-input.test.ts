import { describe, expect, test } from "bun:test"

import { buildExtractionInput } from "./extraction-input"
import { extractionSources } from "./extraction-adapter.test-fixture"

describe("certification extraction input", () => {
  test("projects exact artifact bytes, media type, objective, and frozen references", () => {
    // given
    const sources = extractionSources()

    // when
    const input = buildExtractionInput(sources)

    // then
    expect(input).toEqual({
      artifact: { media_type: "text/markdown", content: sources.artifact_content },
      objective: { source_id: "objective", content: sources.objective_content },
      references: [{ source_id: "reference-01", content: sources.references[0]?.content }],
    })
  })

  test("excludes campaign, sibling, verdict, provenance, and evidence metadata", () => {
    // given
    const input = {
      ...extractionSources(),
      campaign_id: "FORBIDDEN_CAMPAIGN",
      sibling_artifact: "FORBIDDEN_SIBLING",
      verdict: "FORBIDDEN_VERDICT",
      session_id: "FORBIDDEN_SESSION",
      evidence_type: "FORBIDDEN_EVIDENCE",
    }

    // when
    const serialized = JSON.stringify(buildExtractionInput(input))

    // then
    for (const sentinel of ["FORBIDDEN_CAMPAIGN", "FORBIDDEN_SIBLING", "FORBIDDEN_VERDICT", "FORBIDDEN_SESSION", "FORBIDDEN_EVIDENCE"]) {
      expect(serialized).not.toContain(sentinel)
    }
    expect(serialized).not.toContain("evidence_type")
  })

  test("rejects stale artifact, objective, and reference hashes", () => {
    // given
    const sources = extractionSources()
    const invalid = [
      { ...sources, artifact: { ...sources.artifact, artifact_sha256: "a".repeat(64) } },
      { ...sources, objective_sha256: "b".repeat(64) },
      { ...sources, references: [{ ...sources.references[0], source_sha256: "c".repeat(64) }] },
    ]

    // when
    const actions = invalid.map((value) => () => buildExtractionInput(value))

    // then
    for (const action of actions) expect(action).toThrow()
  })
})
