import type { z } from "zod"

import { compareCodeUnits, normalizeCertificationText } from "./canonical-text"
import type { CertificationGraphContract, CertificationObligationNodeContract } from "./graph-contract-types"
import { hashCertificationAssumption, hashCertificationGraph, hashCertificationNode } from "./graph-hashes"

export function validateCertificationGraph(graph: CertificationGraphContract, context: z.RefinementCtx): void {
  const assumptions = validateAssumptions(graph, context)
  const nodes = validateNodes(graph, assumptions, context)
  validateEdges(graph, nodes, context)
  validateSpans(graph.nodes, context)
  if (hashCertificationGraph(graph) !== graph.graph_sha256) addIssue(context, ["graph_sha256"], "Graph hash must bind canonical graph bytes")
}

function validateAssumptions(graph: CertificationGraphContract, context: z.RefinementCtx): Map<string, CertificationGraphContract["assumptions"][number]> {
  const byId = new Map<string, CertificationGraphContract["assumptions"][number]>()
  for (const [index, assumption] of graph.assumptions.entries()) {
    const expectedId = `assumption-${String(index + 1).padStart(4, "0")}`
    if (assumption.assumption_id !== expectedId) addIssue(context, ["assumptions", index, "assumption_id"], "Assumptions must use canonical sequential IDs")
    if (index > 0 && compareAssumptions(graph.assumptions[index - 1], assumption) > 0) addIssue(context, ["assumptions", index], "Assumptions must use canonical ordering")
    if (byId.has(assumption.assumption_id)) addIssue(context, ["assumptions", index, "assumption_id"], "Assumption IDs must be unique")
    if (hashCertificationAssumption(assumption) !== assumption.assumption_sha256) addIssue(context, ["assumptions", index, "assumption_sha256"], "Assumption hash must bind canonical assumption bytes")
    byId.set(assumption.assumption_id, assumption)
  }
  return byId
}

function validateNodes(
  graph: CertificationGraphContract,
  assumptions: ReadonlyMap<string, CertificationGraphContract["assumptions"][number]>,
  context: z.RefinementCtx,
): Map<string, CertificationObligationNodeContract> {
  const byId = new Map<string, CertificationObligationNodeContract>()
  const claims = new Set<string>()
  for (const [index, node] of graph.nodes.entries()) {
    const expectedId = `obligation-${String(index + 1).padStart(4, "0")}`
    if (node.obligation_id !== expectedId) addIssue(context, ["nodes", index, "obligation_id"], "Nodes must use canonical sequential IDs")
    if (index > 0 && compareNodes(graph.nodes[index - 1], node) > 0) addIssue(context, ["nodes", index], "Nodes must use canonical source ordering")
    if (byId.has(node.obligation_id)) addIssue(context, ["nodes", index, "obligation_id"], "Obligation IDs must be unique")
    validateSortedUnique(node.prerequisite_ids, context, ["nodes", index, "prerequisite_ids"])
    validateBindings(node, assumptions, context, index)
    if (hashCertificationNode(node) !== node.node_sha256) addIssue(context, ["nodes", index, "node_sha256"], "Node hash must bind canonical node bytes")
    const claim = `${node.source_span.start_byte}\n${node.source_span.end_byte}\n${node.kind}\n${node.statement}`
    if (claims.has(claim)) addIssue(context, ["nodes", index], "Duplicate span, kind, and statement claims are forbidden")
    claims.add(claim)
    byId.set(node.obligation_id, node)
  }
  return byId
}

function validateBindings(
  node: CertificationObligationNodeContract,
  assumptions: ReadonlyMap<string, CertificationGraphContract["assumptions"][number]>,
  context: z.RefinementCtx,
  index: number,
): void {
  const ids = node.assumption_bindings.map((binding) => binding.assumption_id)
  validateSortedUnique(ids, context, ["nodes", index, "assumption_bindings"])
  for (const binding of node.assumption_bindings) {
    const assumption = assumptions.get(binding.assumption_id)
    if (assumption === undefined || assumption.assumption_sha256 !== binding.assumption_sha256) {
      addIssue(context, ["nodes", index, "assumption_bindings"], "Assumption bindings must reference exact stored assumptions")
    }
  }
  if (node.kind === "IMPORTED_RESULT" && !node.assumption_bindings.some((binding) => assumptions.get(binding.assumption_id)?.source_kind === "REFERENCE")) {
    addIssue(context, ["nodes", index, "assumption_bindings"], "Imported results require a frozen reference assumption")
  }
}

function validateEdges(graph: CertificationGraphContract, nodes: ReadonlyMap<string, CertificationObligationNodeContract>, context: z.RefinementCtx): void {
  for (const [index, node] of graph.nodes.entries()) {
    for (const prerequisiteId of node.prerequisite_ids) {
      if (!nodes.has(prerequisiteId)) addIssue(context, ["nodes", index, "prerequisite_ids"], "Prerequisite target must exist")
      if (prerequisiteId === node.obligation_id) addIssue(context, ["nodes", index, "prerequisite_ids"], "Self prerequisites are forbidden")
    }
  }
  validateCycles(graph.nodes, nodes, context)
  validateRequiredClosure(graph, nodes, context)
}

function validateCycles(nodes: readonly CertificationObligationNodeContract[], byId: ReadonlyMap<string, CertificationObligationNodeContract>, context: z.RefinementCtx): void {
  const complete = new Set<string>()
  const active = new Set<string>()
  const visit = (node: CertificationObligationNodeContract): boolean => {
    if (active.has(node.obligation_id)) return true
    if (complete.has(node.obligation_id)) return false
    active.add(node.obligation_id)
    const cyclic = node.prerequisite_ids.some((id) => {
      const prerequisite = byId.get(id)
      return prerequisite !== undefined && visit(prerequisite)
    })
    active.delete(node.obligation_id)
    complete.add(node.obligation_id)
    return cyclic
  }
  if (nodes.some(visit)) addIssue(context, ["nodes"], "Prerequisite graph must be acyclic")
}

function validateRequiredClosure(graph: CertificationGraphContract, nodes: ReadonlyMap<string, CertificationObligationNodeContract>, context: z.RefinementCtx): void {
  validateSortedUnique(graph.required_root_ids, context, ["required_root_ids"])
  const reachable = certificationPrerequisiteClosureIds(graph, graph.required_root_ids)
  for (const rootId of graph.required_root_ids) {
    const root = nodes.get(rootId)
    if (root === undefined || !root.required) addIssue(context, ["required_root_ids"], "Required roots must exist and be required")
  }
  for (const [index, node] of graph.nodes.entries()) {
    if (reachable.has(node.obligation_id) && !node.required) addIssue(context, ["nodes", index, "required"], "Every prerequisite in required closure must be required")
    if (node.required && !reachable.has(node.obligation_id)) addIssue(context, ["nodes", index, "required"], "Every required node must be reachable from a required root")
  }
}

export function certificationPrerequisiteClosureIds(
  graph: CertificationGraphContract,
  rootIds: readonly string[],
): ReadonlySet<string> {
  const nodes = new Map(graph.nodes.map((node) => [node.obligation_id, node]))
  const reachable = new Set<string>()
  const visit = (id: string): void => {
    if (reachable.has(id)) return
    reachable.add(id)
    nodes.get(id)?.prerequisite_ids.forEach(visit)
  }
  rootIds.forEach(visit)
  return reachable
}

function validateSpans(nodes: readonly CertificationObligationNodeContract[], context: z.RefinementCtx): void {
  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    const left = nodes[leftIndex]
    if (left === undefined) continue
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      const right = nodes[rightIndex]
      if (right === undefined) continue
      const identical = left.source_span.start_byte === right.source_span.start_byte
        && left.source_span.end_byte === right.source_span.end_byte
      const qualifiedIdentical = identical
        && left.kind !== right.kind
        && normalizeCertificationText(left.statement) !== normalizeCertificationText(right.statement)
      const disjoint = left.source_span.end_byte <= right.source_span.start_byte
        || right.source_span.end_byte <= left.source_span.start_byte
      const strictlyNested = left.source_span.start_byte < right.source_span.start_byte
        && right.source_span.end_byte < left.source_span.end_byte
        || right.source_span.start_byte < left.source_span.start_byte
        && left.source_span.end_byte < right.source_span.end_byte
      if (!qualifiedIdentical && !disjoint && !strictlyNested) addIssue(context, ["nodes", rightIndex, "source_span"], "Overlapping source spans must be qualified identical spans or strictly nested")
    }
  }
}

function compareAssumptions(left: CertificationGraphContract["assumptions"][number] | undefined, right: CertificationGraphContract["assumptions"][number]): number {
  if (left === undefined) return 0
  const leftStart = left.source_span?.start_byte ?? -1
  const rightStart = right.source_span?.start_byte ?? -1
  const leftEnd = left.source_span?.end_byte ?? -1
  const rightEnd = right.source_span?.end_byte ?? -1
  return compareCodeUnits(left.source_kind, right.source_kind)
    || compareCodeUnits(left.source_id, right.source_id)
    || leftStart - rightStart || leftEnd - rightEnd
    || compareCodeUnits(left.statement, right.statement)
}

function compareNodes(left: CertificationObligationNodeContract | undefined, right: CertificationObligationNodeContract): number {
  if (left === undefined) return 0
  return left.source_span.start_byte - right.source_span.start_byte
    || left.source_span.end_byte - right.source_span.end_byte
    || compareCodeUnits(left.kind, right.kind)
    || compareCodeUnits(left.statement, right.statement)
}

function validateSortedUnique(values: readonly string[], context: z.RefinementCtx, path: readonly (string | number)[]): void {
  if (new Set(values).size !== values.length || values.some((value, index) => index > 0 && compareCodeUnits(values[index - 1] ?? "", value) > 0)) {
    addIssue(context, path, "Identifiers must be sorted and unique")
  }
}

function addIssue(context: z.RefinementCtx, path: readonly (string | number)[], message: string): void {
  context.addIssue({ code: "custom", path: [...path], message })
}
