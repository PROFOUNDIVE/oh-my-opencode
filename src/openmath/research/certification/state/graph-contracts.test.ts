import { describe, expect, test } from "bun:test"

import { sha256 } from "../../../workflow/stage-runner/sha256"
import { CertificationGraphSchema } from "./graph"
import { CertificationGraphSourceValidationSchema } from "./graph-source-validation"
import { graphSourceContext, mixedGraphFixture } from "./certification-test-fixture"

describe("canonical certification graph", () => {
  test("accepts a source-bound mixed six-kind node-to-prerequisite DAG", () => {
    // given
    const input = graphSourceContext()

    // when
    const parsed = CertificationGraphSourceValidationSchema.safeParse(input)

    // then
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.graph.nodes.map((node) => node.kind)).toEqual([
      "THEOREM",
      "LEMMA",
      "CLAIM",
      "DEFINITION",
      "IMPORTED_RESULT",
      "COMPUTATION",
    ])
  })

  test("rejects noncanonical graph ordering, duplicate claims, cycles, and missing prerequisites", () => {
    // given
    const graph = mixedGraphFixture()
    const first = graph.nodes[0]
    const second = graph.nodes[1]
    if (first === undefined || second === undefined) throw new TypeError("Missing graph fixture nodes")
    const invalid = [
      { ...graph, assumptions: [...graph.assumptions].reverse() },
      { ...graph, nodes: [...graph.nodes].reverse() },
      { ...graph, required_root_ids: ["obligation-0001", "obligation-0001"] },
      { ...graph, nodes: graph.nodes.map((node, index) => index === 1 ? { ...node, prerequisite_ids: ["obligation-0001"] } : node) },
      { ...graph, nodes: graph.nodes.map((node, index) => index === 0 ? { ...node, prerequisite_ids: ["obligation-9999"] } : node) },
      { ...graph, nodes: [...graph.nodes, { ...second, obligation_id: "obligation-0007", node_sha256: second.node_sha256 }] },
    ]

    // when
    const results = invalid.map((value) => CertificationGraphSchema.safeParse(value))

    // then
    expect(results.every((result) => !result.success)).toBe(true)
  })

  test("enforces required-root closure in the node-to-prerequisite direction", () => {
    // given
    const graph = mixedGraphFixture()
    const optionalPrerequisite = rehashNode(graph, 1, { required: false })
    const unreachableRequired = rehashNode(graph, 0, { prerequisite_ids: ["obligation-0002"] })

    // when
    const optionalResult = CertificationGraphSchema.safeParse(rehashGraph({ ...graph, nodes: optionalPrerequisite }))
    const unreachableResult = CertificationGraphSchema.safeParse(rehashGraph({ ...graph, nodes: unreachableRequired }))

    // then
    expect(optionalResult.success).toBe(false)
    expect(unreachableResult.success).toBe(false)
  })

  test("rejects crossing source spans while allowing strict nesting", () => {
    // given
    const graph = mixedGraphFixture()
    const crossing = rehashNode(graph, 1, { source_span: { start_byte: 4, end_byte: 12, span_sha256: "a".repeat(64) } })
    const nested = rehashNode(graph, 1, { source_span: { start_byte: 1, end_byte: 6, span_sha256: "a".repeat(64) } })

    // when
    const crossingResult = CertificationGraphSchema.safeParse(rehashGraph({ ...graph, nodes: crossing }))
    const nestedResult = CertificationGraphSchema.safeParse(rehashGraph({ ...graph, nodes: nested }))

    // then
    expect(crossingResult.success).toBe(false)
    expect(nestedResult.success).toBe(true)
  })

  test("rejects overlapping spans that share only one boundary", () => {
    // given
    const graph = mixedGraphFixture()
    const equalEnd = rehashNode(graph, 1, {
      source_span: { start_byte: 2, end_byte: 7, span_sha256: "a".repeat(64) },
    })

    // when
    const parsed = CertificationGraphSchema.safeParse(rehashGraph({ ...graph, nodes: equalEnd }))

    // then
    expect(parsed.success).toBe(false)
  })

  test("rejects identical source spans with the same kind despite different statements", () => {
    // given
    const graph = mixedGraphFixture()
    const first = graph.nodes[0]
    if (first === undefined) throw new TypeError("Missing graph fixture node")
    const nodes = rehashNode(graph, 1, {
      kind: first.kind,
      source_span: first.source_span,
      statement: "Z theorem restatement",
    })

    // when
    const parsed = CertificationGraphSchema.safeParse(rehashGraph({ ...graph, nodes }))

    // then
    expect(parsed.success).toBe(false)
  })

  test("allows identical source spans with different kinds and statements", () => {
    // given
    const graph = mixedGraphFixture()
    const first = graph.nodes[0]
    if (first === undefined) throw new TypeError("Missing graph fixture node")
    const firstChanged = rehashNode(graph, 0, { kind: "LEMMA" })
    const nodes = rehashNode({ ...graph, nodes: firstChanged }, 1, {
      kind: "THEOREM",
      source_span: first.source_span,
    })

    // when
    const parsed = CertificationGraphSchema.safeParse(rehashGraph({ ...graph, nodes }))

    // then
    expect(parsed.success).toBe(true)
  })
})

function rehashNode(graph: ReturnType<typeof mixedGraphFixture>, index: number, changes: Record<string, unknown>) {
  return graph.nodes.map((node, nodeIndex) => {
    if (nodeIndex !== index) return node
    const core = {
      obligation_id: node.obligation_id,
      kind: node.kind,
      source_span: node.source_span,
      statement: node.statement,
      prerequisite_ids: node.prerequisite_ids,
      assumption_bindings: node.assumption_bindings,
      required: node.required,
      ...changes,
    }
    return { ...core, node_sha256: sha256(JSON.stringify(core)) }
  })
}

function rehashGraph(graph: ReturnType<typeof mixedGraphFixture>) {
  const { graph_sha256: _graphSha256, ...core } = graph
  return { ...core, graph_sha256: sha256(JSON.stringify(core)) }
}
