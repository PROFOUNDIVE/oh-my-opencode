import { describe, expect, test } from "bun:test"

import { sha256 } from "../../../workflow/stage-runner/sha256"
import { buildCoverageInput } from "./coverage-input"
import { adaptExtractionOutput } from "./extraction-output-adapter"
import { extractionOutput, extractionSources } from "./extraction-adapter.test-fixture"

describe("certification coverage input", () => {
  test("projects exact artifact bytes, media type, canonical graph, and finding cap", () => {
    // given
    const sources = extractionSources()
    const graph = canonicalGraph()

    // when
    const input = buildCoverageInput({ graph, sources, max_findings: 4 })

    // then
    expect(input).toEqual({
      artifact: { media_type: "text/markdown", content: sources.artifact_content },
      graph,
      max_findings: 4,
    })
    expect(JSON.stringify(input)).not.toContain("evidence_type")
  })

  test("rejects invalid, stale, or fabricated graphs before coverage", () => {
    // given
    const sources = extractionSources()
    const graph = canonicalGraph()
    const invalid = [
      { graph: { ...graph, graph_sha256: "f".repeat(64) }, sources, max_findings: 4 },
      { graph, sources: { ...sources, artifact_content: `${sources.artifact_content} stale` }, max_findings: 4 },
      { graph, sources: { ...sources, references: [{ ...sources.references[0], source_sha256: "e".repeat(64) }] }, max_findings: 4 },
    ]

    // when
    const actions = invalid.map((value) => () => buildCoverageInput(value))

    // then
    for (const action of actions) expect(action).toThrow()
  })

  test("preserves legacy JSON artifact bytes without parsing or reserializing", () => {
    // given
    const artifactContent = "{ \"claim\" : \"A\" }\n"
    const sources = {
      ...extractionSources(),
      artifact: {
        ...extractionSources().artifact,
        media_type: "application/vnd.openmath.legacy+json" as const,
        artifact_sha256: sha256(artifactContent),
      },
      artifact_content: artifactContent,
    }
    const raw = JSON.stringify({
      assumptions: [],
      nodes: [{
        local_id: "root",
        kind: "CLAIM",
        source_span: { start_byte: 2, end_byte: 9, span_sha256: sha256("\"claim\"") },
        statement: "\"claim\"",
        prerequisite_local_ids: [],
        assumption_local_ids: [],
        required: true,
      }],
      required_root_local_ids: ["root"],
    })
    const extracted = adaptExtractionOutput(raw, { sources, max_obligations: 4 })
    if (!extracted.ok) throw new TypeError("Expected legacy JSON extraction graph")

    // when
    const input = buildCoverageInput({ graph: extracted.graph, sources, max_findings: 2 })

    // then
    expect(input.artifact.content).toBe(artifactContent)
    expect(input.artifact.media_type).toBe("application/vnd.openmath.legacy+json")
  })
})

function canonicalGraph() {
  const result = adaptExtractionOutput(JSON.stringify(extractionOutput()), {
    sources: extractionSources(),
    max_obligations: 8,
  })
  if (!result.ok) throw new TypeError("Expected extraction fixture graph")
  return result.graph
}
