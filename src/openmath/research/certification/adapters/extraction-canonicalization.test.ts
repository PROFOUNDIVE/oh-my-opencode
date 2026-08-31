import { describe, expect, test } from "bun:test"

import { adaptExtractionOutput } from "./extraction-output-adapter"
import { extractionOutput, extractionSources } from "./extraction-adapter.test-fixture"

describe("certification extraction canonicalization", () => {
  test("normalizes text, remaps local IDs, and emits schema-ordered hashes", () => {
    // given
    const rawOutput = JSON.stringify(extractionOutput())

    // when
    const result = adaptExtractionOutput(rawOutput, { sources: extractionSources(), max_obligations: 8 })

    // then
    expect(result.ok).toBe(true)
    if (!result.ok) throw new TypeError("Expected canonical extraction graph")
    expect(result.graph.assumptions).toMatchObject([{
      assumption_id: "assumption-0001",
      statement: "Imported\nlemma is available.",
      source_kind: "REFERENCE",
      source_id: "reference-01",
    }])
    expect(result.graph.nodes.map((node) => ({
      id: String(node.obligation_id),
      statement: node.statement,
      prerequisites: node.prerequisite_ids.map(String),
      assumptions: node.assumption_bindings.map((binding) => String(binding.assumption_id)),
    }))).toEqual([{
      id: "obligation-0001",
      statement: "Root theorem",
      prerequisites: ["obligation-0002"],
      assumptions: [],
    }, {
      id: "obligation-0002",
      statement: "Imported lemma",
      prerequisites: [],
      assumptions: ["assumption-0001"],
    }])
    expect(Object.keys(result.graph)).toEqual(["schema_version", "artifact", "assumptions", "nodes", "required_root_ids", "graph_sha256"])
  })

  test("produces byte-identical graph serialization for equivalent local IDs and ordering", () => {
    // given
    const first = extractionOutput()
    const second = {
      assumptions: first.assumptions.map((assumption) => ({ ...assumption, local_id: "renamed-assumption" })),
      nodes: [...first.nodes].reverse().map((node) => ({
        ...node,
        local_id: node.local_id === "root" ? "renamed-root" : "renamed-imported",
        prerequisite_local_ids: node.prerequisite_local_ids.map(() => "renamed-imported"),
        assumption_local_ids: node.assumption_local_ids.map(() => "renamed-assumption"),
      })),
      required_root_local_ids: ["renamed-root"],
    }

    // when
    const left = adaptExtractionOutput(JSON.stringify(first), { sources: extractionSources(), max_obligations: 8 })
    const right = adaptExtractionOutput(JSON.stringify(second), { sources: extractionSources(), max_obligations: 8 })

    // then
    expect(left.ok && right.ok).toBe(true)
    if (!left.ok || !right.ok) throw new TypeError("Expected equivalent extraction graphs")
    expect(JSON.stringify(left.graph)).toBe(JSON.stringify(right.graph))
    expect(left.graph.graph_sha256).toBe(right.graph.graph_sha256)
  })
})
