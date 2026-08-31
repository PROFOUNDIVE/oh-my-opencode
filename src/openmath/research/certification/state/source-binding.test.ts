import { describe, expect, test } from "bun:test"

import { sha256 } from "../../../workflow/stage-runner/sha256"
import { CoverageSourceValidationSchema } from "./coverage-source-validation"
import { CertificationGraphSchema } from "./graph"
import { CertificationGraphSourceValidationSchema } from "./graph-source-validation"
import { graphSourceContext } from "./certification-test-fixture"

describe("certification source spans and assumptions", () => {
  test("rejects coverage findings whose spans do not bind exact artifact bytes", () => {
    // given
    const artifactContent = "é theorem"
    const coverage = {
      coverage_review_id: "coverage-0001",
      certification_revision: 2,
      job_id: "cert-job-coverage-0001",
      coverage_round: 1,
      artifact_sha256: sha256(artifactContent),
      graph_sha256: "a".repeat(64),
      verdict: "REVISE",
      findings: [{
        kind: "MISSING_CLAIM",
        source_span: { start_byte: 1, end_byte: 2, span_sha256: sha256("é") },
        obligation_ids: [],
        message: "Missing claim.",
        suggested_correction: "Add the claim.",
      }],
    }

    // when
    const parsed = CoverageSourceValidationSchema.safeParse({ coverage, artifact_content: artifactContent })

    // then
    expect(parsed.success).toBe(false)
  })

  test("rejects a non-boundary UTF-8 offset and exact span hash mismatch", () => {
    // given
    const base = graphSourceContext()
    const source = "éx"
    const artifact = { ...base.graph.artifact, artifact_sha256: sha256(source) }
    const assumption = base.graph.assumptions[0]
    const node = base.graph.nodes[0]
    if (assumption === undefined || node === undefined) throw new TypeError("Missing graph fixture")
    const graph = graphWithOneNode({
      artifact,
      assumption: {
        ...assumption,
        source_id: artifact.candidate_id,
        source_sha256: artifact.artifact_sha256,
      },
      node: { ...node, source_span: { start_byte: 1, end_byte: 2, span_sha256: sha256("é") } },
    })
    const input = {
      graph,
      sources: { ...base.sources, artifact, artifact_content: source },
    }

    // when
    const splitBoundary = CertificationGraphSourceValidationSchema.safeParse(input)
    const badHash = CertificationGraphSourceValidationSchema.safeParse({
      ...input,
      graph: graphWithOneNode({
        artifact,
        assumption: { ...assumption, source_id: artifact.candidate_id, source_sha256: artifact.artifact_sha256 },
        node: { ...node, source_span: { start_byte: 0, end_byte: 2, span_sha256: "f".repeat(64) } },
      }),
    })

    // then
    expect(splitBoundary.success).toBe(false)
    expect(badHash.success).toBe(false)
  })

  test("rejects dangling assumptions and imported results without a frozen reference binding", () => {
    // given
    const base = graphSourceContext()
    const importedIndex = base.graph.nodes.findIndex((node) => node.kind === "IMPORTED_RESULT")
    const imported = base.graph.nodes[importedIndex]
    if (imported === undefined) throw new TypeError("Missing imported fixture node")
    const dangling = rehashNode(base.graph, importedIndex, {
      assumption_bindings: [{ assumption_id: "assumption-9999", assumption_sha256: "a".repeat(64) }],
    })
    const artifactOnly = rehashNode(base.graph, importedIndex, {
      assumption_bindings: [base.graph.nodes[0]?.assumption_bindings[0]],
    })

    // when
    const danglingResult = CertificationGraphSchema.safeParse(rehashGraph({ ...base.graph, nodes: dangling }))
    const importedResult = CertificationGraphSchema.safeParse(rehashGraph({ ...base.graph, nodes: artifactOnly }))

    // then
    expect(danglingResult.success).toBe(false)
    expect(importedResult.success).toBe(false)
  })

  test("reference hash mutation must cascade through assumption, imported node, and graph hashes", () => {
    // given
    const base = graphSourceContext()
    const referenceIndex = base.graph.assumptions.findIndex((item) => item.source_kind === "REFERENCE")
    const reference = base.graph.assumptions[referenceIndex]
    if (reference === undefined) throw new TypeError("Missing reference fixture assumption")
    const changed = { ...reference, source_sha256: "f".repeat(64) }

    // when
    const staleAssumption = CertificationGraphSchema.safeParse({
      ...base.graph,
      assumptions: base.graph.assumptions.map((item, index) => index === referenceIndex ? changed : item),
    })
    const changedWithHash = { ...changed, assumption_sha256: hashWithout(changed, "assumption_sha256") }
    const staleNode = CertificationGraphSchema.safeParse({
      ...base.graph,
      assumptions: base.graph.assumptions.map((item, index) => index === referenceIndex ? changedWithHash : item),
    })

    // then
    expect(staleAssumption.success).toBe(false)
    expect(staleNode.success).toBe(false)
  })
})

type GraphFixture = ReturnType<typeof graphSourceContext>["graph"]

function graphWithOneNode(input: {
  artifact: GraphFixture["artifact"]
  assumption: GraphFixture["assumptions"][number]
  node: GraphFixture["nodes"][number]
}) {
  const assumption = { ...input.assumption, assumption_sha256: hashWithout(input.assumption, "assumption_sha256") }
  const nodeCore = {
    ...input.node,
    prerequisite_ids: [],
    assumption_bindings: [{
      assumption_id: assumption.assumption_id,
      assumption_sha256: assumption.assumption_sha256,
    }],
    required: true,
  }
  const node = { ...nodeCore, node_sha256: hashWithout(nodeCore, "node_sha256") }
  const core = { schema_version: 1, artifact: input.artifact, assumptions: [assumption], nodes: [node], required_root_ids: [node.obligation_id] }
  return { ...core, graph_sha256: sha256(JSON.stringify(core)) }
}

function rehashNode(graph: ReturnType<typeof graphSourceContext>["graph"], index: number, changes: Record<string, unknown>) {
  return graph.nodes.map((node, nodeIndex) => nodeIndex === index
    ? { ...node, ...changes, node_sha256: hashWithout({ ...node, ...changes }, "node_sha256") }
    : node)
}

function rehashGraph(graph: ReturnType<typeof graphSourceContext>["graph"]) {
  const { graph_sha256: _graphSha256, ...core } = graph
  return { ...core, graph_sha256: sha256(JSON.stringify(core)) }
}

function hashWithout(value: Readonly<Record<string, unknown>>, key: string): string {
  return sha256(JSON.stringify(Object.fromEntries(Object.entries(value).filter(([name]) => name !== key))))
}
