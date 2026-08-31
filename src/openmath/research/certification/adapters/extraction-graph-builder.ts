import type { z } from "zod"

import { CertificationAssumptionSchema, type CertificationAssumption } from "../state/assumptions"
import { compareCodeUnits, normalizeCertificationText } from "../state/canonical-text"
import { CertificationGraphSchema, CertificationObligationNodeSchema, type CertificationGraph, type CertificationObligationNode } from "../state/graph"
import { hashCertificationAssumption, hashCertificationGraph, hashCertificationNode } from "../state/graph-hashes"
import { CertificationGraphSourceValidationSchema, type CertificationGraphSources } from "../state/graph-source-validation"
import { AssumptionIdSchema, CertificationSha256Schema, ObligationIdSchema } from "../state/literals"
import type { ExtractionModelOutput } from "./extraction-model-output"

export function buildExtractionGraph(
  output: ExtractionModelOutput,
  sources: CertificationGraphSources,
): CertificationGraph | null {
  const assumptionEntries = output.assumptions.map((assumption) => sourceBoundAssumption(assumption, sources))
  if (assumptionEntries.some((entry) => entry === null)) return null
  const sortedAssumptions = assumptionEntries.filter((entry) => entry !== null).sort(compareAssumptionEntries)
  if (sortedAssumptions.some((entry, index) => index > 0 && compareAssumptionEntries(sortedAssumptions[index - 1] ?? entry, entry) === 0)) return null
  const assumptionIds = new Map<string, CertificationAssumption>()
  const assumptions = sortedAssumptions.map((entry, index) => {
    const assumptionId = AssumptionIdSchema.parse(`assumption-${String(index + 1).padStart(4, "0")}`)
    const core = {
      assumption_id: assumptionId,
      statement: entry.statement,
      source_kind: entry.source_kind,
      source_id: entry.source_id,
      source_sha256: entry.source_sha256,
      source_span: entry.source_span,
    }
    const draft = CertificationAssumptionSchema.parse({ ...core, assumption_sha256: CertificationSha256Schema.parse("0".repeat(64)) })
    const stored = CertificationAssumptionSchema.parse({ ...core, assumption_sha256: hashCertificationAssumption(draft) })
    assumptionIds.set(entry.local_id, stored)
    return stored
  })
  const sortedNodes = [...output.nodes].sort((left, right) => left.source_span.start_byte - right.source_span.start_byte
    || left.source_span.end_byte - right.source_span.end_byte
    || compareCodeUnits(left.kind, right.kind)
    || compareCodeUnits(normalizeCertificationText(left.statement), normalizeCertificationText(right.statement)))
  const nodeIds = new Map(sortedNodes.map((node, index) => [
    node.local_id,
    ObligationIdSchema.parse(`obligation-${String(index + 1).padStart(4, "0")}`),
  ]))
  const nodes = buildNodes(sortedNodes, nodeIds, assumptionIds)
  const requiredRootIds = resolveIds(output.required_root_local_ids, nodeIds)
  if (nodes === null || requiredRootIds === null) return null
  const core = {
    schema_version: 1 as const,
    artifact: sources.artifact,
    assumptions,
    nodes,
    required_root_ids: requiredRootIds,
  }
  const graph = CertificationGraphSchema.safeParse({
    ...core,
    graph_sha256: hashCertificationGraph({ ...core, graph_sha256: sources.artifact.artifact_sha256 }),
  })
  if (!graph.success) return null
  const sourceBound = CertificationGraphSourceValidationSchema.safeParse({ graph: graph.data, sources })
  return sourceBound.success ? sourceBound.data.graph : null
}

type AssumptionEntry = Readonly<{
  readonly local_id: string
  readonly statement: string
  readonly source_kind: "ARTIFACT" | "OBJECTIVE" | "REFERENCE"
  readonly source_id: string
  readonly source_sha256: CertificationGraphSources["artifact"]["artifact_sha256"]
  readonly source_span: ExtractionModelOutput["assumptions"][number]["source_span"]
}>

function sourceBoundAssumption(
  assumption: ExtractionModelOutput["assumptions"][number],
  sources: CertificationGraphSources,
): AssumptionEntry | null {
  const common = {
    local_id: assumption.local_id,
    statement: normalizeCertificationText(assumption.statement),
    source_span: assumption.source_span,
  }
  switch (assumption.source_kind) {
    case "ARTIFACT":
      return { ...common, source_kind: "ARTIFACT", source_id: sources.artifact.candidate_id, source_sha256: sources.artifact.artifact_sha256 }
    case "OBJECTIVE":
      return { ...common, source_kind: "OBJECTIVE", source_id: "objective", source_sha256: sources.objective_sha256 }
    case "REFERENCE": {
      const reference = sources.references.find((candidate) => candidate.source_id === assumption.source_id)
      return reference === undefined ? null : { ...common, source_kind: "REFERENCE", source_id: reference.source_id, source_sha256: reference.source_sha256 }
    }
    default:
      return assertNever(assumption)
  }
}

function buildNodes(
  sortedNodes: ExtractionModelOutput["nodes"],
  nodeIds: ReadonlyMap<string, z.infer<typeof ObligationIdSchema>>,
  assumptions: ReadonlyMap<string, CertificationAssumption>,
): readonly CertificationObligationNode[] | null {
  const nodes: CertificationObligationNode[] = []
  for (const node of sortedNodes) {
    const obligationId = nodeIds.get(node.local_id)
    const prerequisiteIds = resolveIds(node.prerequisite_local_ids, nodeIds)
    const bindings = [...new Set(node.assumption_local_ids)].map((localId) => assumptions.get(localId))
    if (obligationId === undefined || prerequisiteIds === null || bindings.some((binding) => binding === undefined)) return null
    const core = {
      obligation_id: obligationId,
      kind: node.kind,
      source_span: node.source_span,
      statement: normalizeCertificationText(node.statement),
      prerequisite_ids: prerequisiteIds,
      assumption_bindings: bindings.filter((binding) => binding !== undefined).map((binding) => ({
        assumption_id: binding.assumption_id,
        assumption_sha256: binding.assumption_sha256,
      })).sort((left, right) => compareCodeUnits(left.assumption_id, right.assumption_id)),
      required: node.required,
    }
    const draft = CertificationObligationNodeSchema.parse({ ...core, node_sha256: CertificationSha256Schema.parse("0".repeat(64)) })
    nodes.push(CertificationObligationNodeSchema.parse({ ...core, node_sha256: hashCertificationNode(draft) }))
  }
  return nodes
}

function resolveIds<T>(localIds: readonly string[], ids: ReadonlyMap<string, T>): readonly T[] | null {
  const resolved = [...new Set(localIds)].map((localId) => ids.get(localId))
  if (resolved.some((value) => value === undefined)) return null
  return resolved.filter((value) => value !== undefined).sort((left, right) => compareCodeUnits(String(left), String(right)))
}

function compareAssumptionEntries(left: AssumptionEntry, right: AssumptionEntry): number {
  return compareCodeUnits(left.source_kind, right.source_kind)
    || compareCodeUnits(left.source_id, right.source_id)
    || (left.source_span?.start_byte ?? -1) - (right.source_span?.start_byte ?? -1)
    || (left.source_span?.end_byte ?? -1) - (right.source_span?.end_byte ?? -1)
    || compareCodeUnits(left.statement, right.statement)
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected extraction assumption: ${String(value)}`)
}
