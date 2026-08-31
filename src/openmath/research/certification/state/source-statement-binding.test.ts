import { describe, expect, test } from "bun:test"

import { sha256 } from "../../../workflow/stage-runner/sha256"
import { CertificationAssumptionSchema } from "./assumptions"
import { CertificationGraphSchema } from "./graph"
import { hashCertificationAssumption, hashCertificationGraph, hashCertificationNode } from "./graph-hashes"
import { CertificationGraphSourceValidationSchema } from "./graph-source-validation"
import { CertificationSha256Schema } from "./literals"
import { CertificationObligationNodeSchema } from "./graph"
import { graphSourceContext } from "./certification-test-fixture"

describe("certification source statement binding", () => {
  test("rejects node and assumption statements that differ from valid frozen-source spans", () => {
    // given
    const base = CertificationGraphSourceValidationSchema.parse(graphSourceContext())
    const sourceKinds = ["ARTIFACT", "OBJECTIVE", "REFERENCE"] as const

    // when
    const results = [
      CertificationGraphSourceValidationSchema.safeParse({ graph: graphWithMismatchedNode(base.graph), sources: base.sources }),
      ...sourceKinds.map((sourceKind) => CertificationGraphSourceValidationSchema.safeParse({
        graph: graphWithMismatchedAssumption(base.graph, base.sources, sourceKind),
        sources: base.sources,
      })),
    ]

    // then
    expect(results.every((result) => !result.success)).toBe(true)
  })
})

type GraphFixture = ReturnType<typeof CertificationGraphSourceValidationSchema.parse>["graph"]
type SourcesFixture = ReturnType<typeof CertificationGraphSourceValidationSchema.parse>["sources"]
type AssumptionSourceKind = GraphFixture["assumptions"][number]["source_kind"]

function graphWithMismatchedNode(graph: GraphFixture) {
  const node = graph.nodes[0]
  if (node === undefined) throw new TypeError("Missing graph node")
  const core = { ...node, statement: "Different proposition" }
  return rehashGraph({ ...graph, nodes: [rehashNode(core), ...graph.nodes.slice(1)] })
}

function graphWithMismatchedAssumption(graph: GraphFixture, sources: SourcesFixture, sourceKind: AssumptionSourceKind) {
  const index = graph.assumptions.findIndex((assumption) => assumption.source_kind === sourceKind)
  const assumption = graph.assumptions[index]
  if (assumption === undefined) throw new TypeError("Missing source-kind assumption")
  const source = sourceContent(sources, sourceKind)
  const core = {
    ...assumption,
    statement: "Different assumption",
    source_span: {
      start_byte: 0,
      end_byte: Buffer.byteLength(source, "utf8"),
      span_sha256: CertificationSha256Schema.parse(sha256(source)),
    },
  }
  const draft = CertificationAssumptionSchema.parse({ ...core, assumption_sha256: CertificationSha256Schema.parse("0".repeat(64)) })
  const updated = CertificationAssumptionSchema.parse({
    ...core,
    assumption_sha256: CertificationSha256Schema.parse(hashCertificationAssumption(draft)),
  })
  const assumptions = graph.assumptions.map((item, itemIndex) => itemIndex === index ? updated : item)
  const nodes = graph.nodes.map((node) => {
    const assumptionBindings = node.assumption_bindings.map((binding) => binding.assumption_id === updated.assumption_id
      ? { ...binding, assumption_sha256: updated.assumption_sha256 }
      : binding)
    return rehashNode({ ...node, assumption_bindings: assumptionBindings })
  })
  return rehashGraph({ ...graph, assumptions, nodes })
}

function sourceContent(sources: SourcesFixture, sourceKind: AssumptionSourceKind): string {
  switch (sourceKind) {
    case "ARTIFACT":
      return sources.artifact_content
    case "OBJECTIVE":
      return sources.objective_content
    case "REFERENCE": {
      const reference = sources.references[0]
      if (reference === undefined) throw new TypeError("Missing frozen reference")
      return reference.content
    }
    default:
      return assertNever(sourceKind)
  }
}

function rehashGraph(graph: GraphFixture) {
  const core = {
    schema_version: graph.schema_version,
    artifact: graph.artifact,
    assumptions: graph.assumptions,
    nodes: graph.nodes,
    required_root_ids: graph.required_root_ids,
  }
  return CertificationGraphSchema.parse({
    ...core,
    graph_sha256: CertificationSha256Schema.parse(hashCertificationGraph({ ...core, graph_sha256: graph.graph_sha256 })),
  })
}

function rehashNode(core: Omit<GraphFixture["nodes"][number], "node_sha256">) {
  const draft = CertificationObligationNodeSchema.parse({ ...core, node_sha256: CertificationSha256Schema.parse("0".repeat(64)) })
  return CertificationObligationNodeSchema.parse({
    ...core,
    node_sha256: CertificationSha256Schema.parse(hashCertificationNode(draft)),
  })
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected source kind: ${String(value)}`)
}
