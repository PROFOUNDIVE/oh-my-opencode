import { describe, expect, test } from "bun:test"

import { sha256 } from "../../../workflow/stage-runner/sha256"
import { CertificationGraphSchema } from "../state/graph"
import { adaptCoverageOutput } from "./coverage-output-adapter"
import { buildCoverageInput } from "./coverage-input"
import { buildCoverageReview } from "./coverage-review-builder"
import { adaptExtractionOutput } from "./extraction-output-adapter"
import { extractionOutput, extractionSources } from "./extraction-adapter.test-fixture"

describe("certification coverage output adapter", () => {
  test("accepts exactly PASS, REVISE, and INCONCLUSIVE", () => {
    // given
    const context = coverageContext()
    const verdicts = ["PASS", "REVISE", "INCONCLUSIVE"] as const

    // when
    const results = verdicts.map((verdict) => adaptCoverageOutput(JSON.stringify({ verdict, findings: [] }), context))

    // then
    expect(results.map((result) => result.ok && result.output.verdict)).toEqual([...verdicts])
  })

  test("accepts bounded source-bound findings and canonicalizes their order", () => {
    // given
    const context = coverageContext()
    const input = context.input
    const root = input.graph.nodes[0]
    if (root === undefined) throw new TypeError("Missing coverage graph root")
    const raw = JSON.stringify({ verdict: "REVISE", findings: [{
      kind: "SOURCE_BINDING",
      source_span: root.source_span,
      obligation_ids: [root.obligation_id],
      message: "Source binding needs review.",
      suggested_correction: "Bind the exact source.",
    }, {
      kind: "MISSING_CLAIM",
      source_span: null,
      obligation_ids: [],
      message: "A claim is missing.",
      suggested_correction: "Add the missing claim.",
    }] })

    // when
    const result = adaptCoverageOutput(raw, context)

    // then
    expect(result.ok).toBe(true)
    if (!result.ok) throw new TypeError("Expected bounded coverage findings")
    expect(result.output.findings.map((finding) => finding.kind)).toEqual(["MISSING_CLAIM", "SOURCE_BINDING"])
  })

  test("rejects over-limit, unknown-obligation, fabricated-span, and hidden dependency findings", () => {
    // given
    const context = coverageContext(1)
    const input = context.input
    const root = input.graph.nodes[0]
    if (root === undefined) throw new TypeError("Missing coverage graph root")
    const finding = {
      kind: "MISSING_CLAIM",
      source_span: null,
      obligation_ids: [],
      message: "Missing claim.",
      suggested_correction: "Add claim.",
    }
    const invalid = [
      { verdict: "REVISE", findings: [finding, finding] },
      { verdict: "REVISE", findings: [{ ...finding, obligation_ids: ["obligation-9999"] }] },
      { verdict: "REVISE", findings: [{ ...finding, source_span: { ...root.source_span, span_sha256: "f".repeat(64) } }] },
      { verdict: "REVISE", findings: [{ ...finding, dependency_ids: [root.obligation_id] }] },
    ]

    // when
    const results = invalid.map((value) => adaptCoverageOutput(JSON.stringify(value), context))

    // then
    expect(results.every((result) => !result.ok)).toBe(true)
  })

  test("rejects malformed wrappers, duplicate keys, legacy verdicts, numeric, proof, certificate, and evidence fields", () => {
    // given
    const context = coverageContext()
    const base = { verdict: "PASS", findings: [] }
    const invalid = [
      "PASS",
      `\`\`\`json\n${JSON.stringify(base)}\n\`\`\``,
      "{\"verdict\":\"PASS\",\"verdict\":\"REVISE\",\"findings\":[]}",
      JSON.stringify({ ...base, verdict: "[CORRECT]" }),
      JSON.stringify({ ...base, score: 1 }),
      JSON.stringify({ ...base, proof: {} }),
      JSON.stringify({ ...base, certificate: {} }),
      JSON.stringify({ ...base, evidence_type: "LLM_REVIEW" }),
    ]

    // when
    const results = invalid.map((raw) => adaptCoverageOutput(raw, context))

    // then
    expect(results.every((result) => !result.ok)).toBe(true)
  })

  test("application code binds PASS to a persisted review and LLM_REVIEW evidence type", () => {
    // given
    const context = coverageContext()
    const input = context.input
    const adapted = adaptCoverageOutput(JSON.stringify({ verdict: "PASS", findings: [] }), context)
    if (!adapted.ok) throw new TypeError("Expected PASS model output")

    // when
    const result = buildCoverageReview({
      output: adapted.output,
      input,
      sources: context.sources,
      coverage_review_id: "coverage-0001",
      certification_revision: 2,
      job_id: "cert-job-coverage-0001",
      coverage_round: 1,
    })

    // then
    expect(result).toMatchObject({
      evidence_type: "LLM_REVIEW",
      coverage: {
        verdict: "PASS",
        artifact_sha256: input.graph.artifact.artifact_sha256,
        graph_sha256: input.graph.graph_sha256,
      },
    })
    expect(Object.keys(adapted.output)).toEqual(["verdict", "findings"])
  })

  test("rejects a rehashed graph with stale frozen-reference binding", () => {
    // given
    const context = coverageContext()
    const graph = staleReferenceGraph(context.input.graph)

    // when
    const result = adaptCoverageOutput(JSON.stringify({ verdict: "PASS", findings: [] }), {
      input: { ...context.input, graph },
      sources: context.sources,
    })

    // then
    expect(result.ok).toBe(false)
  })
})

function coverageContext(maxFindings = 4) {
  const sources = extractionSources()
  const extraction = adaptExtractionOutput(JSON.stringify(extractionOutput()), { sources, max_obligations: 8 })
  if (!extraction.ok) throw new TypeError("Expected extraction fixture graph")
  return {
    input: buildCoverageInput({ graph: extraction.graph, sources, max_findings: maxFindings }),
    sources,
  }
}

function staleReferenceGraph(graph: ReturnType<typeof coverageContext>["input"]["graph"]) {
  const changedAssumptions = graph.assumptions.map((assumption) => {
    if (assumption.source_kind !== "REFERENCE") return assumption
    const core = { ...assumption, source_sha256: "f".repeat(64), assumption_sha256: undefined }
    const { assumption_sha256: _omitted, ...preimage } = core
    return { ...preimage, assumption_sha256: sha256(JSON.stringify(preimage)) }
  })
  const changedNodes = graph.nodes.map((node) => {
    const assumption_bindings = node.assumption_bindings.map((binding) => {
      const assumption = changedAssumptions.find((candidate) => candidate.assumption_id === binding.assumption_id)
      return assumption === undefined ? binding : { ...binding, assumption_sha256: assumption.assumption_sha256 }
    })
    const preimage = {
      obligation_id: node.obligation_id,
      kind: node.kind,
      source_span: node.source_span,
      statement: node.statement,
      prerequisite_ids: node.prerequisite_ids,
      assumption_bindings,
      required: node.required,
    }
    return { ...preimage, node_sha256: sha256(JSON.stringify(preimage)) }
  })
  const preimage = {
    schema_version: 1 as const,
    artifact: graph.artifact,
    assumptions: changedAssumptions,
    nodes: changedNodes,
    required_root_ids: graph.required_root_ids,
  }
  return CertificationGraphSchema.parse({ ...preimage, graph_sha256: sha256(JSON.stringify(preimage)) })
}
