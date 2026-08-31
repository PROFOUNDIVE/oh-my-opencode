import { describe, expect, test } from "bun:test"

import { sha256 } from "../../../workflow/stage-runner/sha256"
import { adaptExtractionOutput } from "./extraction-output-adapter"
import { EXTRACTION_ARTIFACT_CONTENT, extractionOutput, extractionSources, sourceSpan } from "./extraction-adapter.test-fixture"

describe("certification extraction rejection", () => {
  test("rejects unknown local dependencies, roots, assumptions, and references", () => {
    // given
    const base = extractionOutput()
    const invalid = [
      { ...base, nodes: base.nodes.map((node, index) => index === 0 ? { ...node, prerequisite_local_ids: ["hidden"] } : node) },
      { ...base, required_root_local_ids: ["hidden"] },
      { ...base, nodes: base.nodes.map((node, index) => index === 0 ? { ...node, assumption_local_ids: ["hidden"] } : node) },
      { ...base, assumptions: base.assumptions.map((assumption) => ({ ...assumption, source_id: "hidden-reference" })) },
    ]

    // when
    const results = invalid.map((value) => adaptExtractionOutput(JSON.stringify(value), { sources: extractionSources(), max_obligations: 8 }))

    // then
    expect(results.every((result) => !result.ok)).toBe(true)
  })

  test("rejects assumptions with equal canonical keys regardless temporary IDs", () => {
    // given
    const base = extractionOutput()
    const duplicate = {
      ...base,
      assumptions: [...base.assumptions, { ...base.assumptions[0], local_id: "duplicate-reference" }],
    }

    // when
    const result = adaptExtractionOutput(JSON.stringify(duplicate), { sources: extractionSources(), max_obligations: 8 })

    // then
    expect(result.ok).toBe(false)
  })

  test("rejects fabricated hashes and split UTF-8 byte offsets", () => {
    // given
    const base = extractionOutput()
    const fabricated = { ...base, nodes: base.nodes.map((node, index) => index === 0
      ? { ...node, source_span: { ...node.source_span, span_sha256: "f".repeat(64) } }
      : node) }
    const unicodeContent = `${EXTRACTION_ARTIFACT_CONTENT}\né`
    const unicodeSources = {
      ...extractionSources(),
      artifact: { ...extractionSources().artifact, artifact_sha256: sha256(unicodeContent) },
      artifact_content: unicodeContent,
    }
    const split = { ...base, nodes: base.nodes.map((node, index) => index === 0
      ? { ...node, source_span: { start_byte: Buffer.byteLength(EXTRACTION_ARTIFACT_CONTENT, "utf8") + 2, end_byte: Buffer.byteLength(unicodeContent, "utf8"), span_sha256: sha256("é") } }
      : node) }

    // when
    const results = [
      adaptExtractionOutput(JSON.stringify(fabricated), { sources: extractionSources(), max_obligations: 8 }),
      adaptExtractionOutput(JSON.stringify(split), { sources: unicodeSources, max_obligations: 8 }),
    ]

    // then
    expect(results.every((result) => !result.ok)).toBe(true)
  })

  test("allows disjoint and strictly nested spans but rejects crossing spans", () => {
    // given
    const base = extractionOutput()
    const nestedSpan = sourceSpan(EXTRACTION_ARTIFACT_CONTENT, "oot theor")
    const extraNode = {
      local_id: "nested",
      kind: "CLAIM",
      source_span: nestedSpan,
      statement: "oot theor",
      prerequisite_local_ids: [],
      assumption_local_ids: [],
      required: false,
    }
    const nested = { ...base, nodes: [...base.nodes, extraNode] }
    const crossing = {
      ...base,
      nodes: [...base.nodes, {
        ...extraNode,
        source_span: {
          start_byte: 5,
          end_byte: 16,
          span_sha256: sha256(EXTRACTION_ARTIFACT_CONTENT.slice(5, 16)),
        },
      }],
    }

    // when
    const nestedResult = adaptExtractionOutput(JSON.stringify(nested), { sources: extractionSources(), max_obligations: 8 })
    const crossingResult = adaptExtractionOutput(JSON.stringify(crossing), { sources: extractionSources(), max_obligations: 8 })

    // then
    expect(nestedResult.ok).toBe(true)
    expect(crossingResult.ok).toBe(false)
  })

  test("rejects optional or unreachable nodes in the required-root closure", () => {
    // given
    const base = extractionOutput()
    const optionalPrerequisite = { ...base, nodes: base.nodes.map((node) => node.local_id === "imported" ? { ...node, required: false } : node) }
    const unreachableRequired = { ...base, nodes: [...base.nodes, {
      local_id: "unreachable",
      kind: "CLAIM",
      source_span: sourceSpan(EXTRACTION_ARTIFACT_CONTENT, "Optional note"),
      statement: "Unreachable required claim",
      prerequisite_local_ids: [],
      assumption_local_ids: [],
      required: true,
    }] }

    // when
    const results = [optionalPrerequisite, unreachableRequired].map((value) => adaptExtractionOutput(JSON.stringify(value), { sources: extractionSources(), max_obligations: 8 }))

    // then
    expect(results.every((result) => !result.ok)).toBe(true)
  })

  test("rejects unknown, proof-certificate, evidence, duplicate-key, malformed, and over-limit output", () => {
    // given
    const base = extractionOutput()
    const invalid = [
      JSON.stringify({ ...base, score: 1 }),
      JSON.stringify({ ...base, proof_certificate: {} }),
      JSON.stringify({ ...base, evidence_type: "LLM_REVIEW" }),
      "{\"assumptions\":[],\"assumptions\":[],\"nodes\":[],\"required_root_local_ids\":[]}",
      `\`\`\`json\n${JSON.stringify(base)}\n\`\`\``,
      JSON.stringify({ ...base, nodes: [...base.nodes, { ...base.nodes[0], local_id: "extra" }] }),
    ]

    // when
    const results = invalid.map((raw) => adaptExtractionOutput(raw, { sources: extractionSources(), max_obligations: 2 }))

    // then
    expect(results.every((result) => !result.ok)).toBe(true)
  })
})
