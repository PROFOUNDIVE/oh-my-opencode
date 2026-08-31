import { sha256 } from "../../../workflow/stage-runner/sha256"
import type { CertificationAssumption } from "./assumptions"
import type { CertificationGraphContract, CertificationObligationNodeContract } from "./graph-contract-types"

export function hashCertificationAssumption(assumption: CertificationAssumption): string {
  return sha256(JSON.stringify({
    assumption_id: assumption.assumption_id,
    statement: assumption.statement,
    source_kind: assumption.source_kind,
    source_id: assumption.source_id,
    source_sha256: assumption.source_sha256,
    source_span: assumption.source_span,
  }))
}

export function hashCertificationNode(node: CertificationObligationNodeContract): string {
  return sha256(JSON.stringify({
    obligation_id: node.obligation_id,
    kind: node.kind,
    source_span: node.source_span,
    statement: node.statement,
    prerequisite_ids: node.prerequisite_ids,
    assumption_bindings: node.assumption_bindings,
    required: node.required,
  }))
}

export function hashCertificationGraph(graph: CertificationGraphContract): string {
  return sha256(JSON.stringify({
    schema_version: graph.schema_version,
    artifact: graph.artifact,
    assumptions: graph.assumptions,
    nodes: graph.nodes,
    required_root_ids: graph.required_root_ids,
  }))
}
