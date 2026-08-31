import { z } from "zod"

import { CertificationAssumptionSchema } from "../state/assumptions"
import { AttackAttemptSchema } from "../state/attacks"
import {
  CertificationGraphSchema,
  CertificationObligationKindSchema,
  CertificationObligationNodeSchema,
} from "../state/graph"
import { certificationPrerequisiteClosureIds } from "../state/graph-invariants"
import {
  CertificationGraphSourcesSchema,
  CertificationGraphSourceValidationSchema,
} from "../state/graph-source-validation"
import {
  AssumptionIdSchema,
  CertificationSha256Schema,
  NonBlankSchema,
  ObligationIdSchema,
} from "../state/literals"
import { CertificationSourceSpanSchema } from "../state/source-span"

const BuildWitnessPayloadSchema = z.object({
  graph: CertificationGraphSchema,
  sources: CertificationGraphSourcesSchema,
  attack: AttackAttemptSchema,
}).strict().readonly()

const WitnessContextNodeSchema = z.object({
  obligation_id: ObligationIdSchema,
  kind: CertificationObligationKindSchema,
  statement: NonBlankSchema,
  source_span: CertificationSourceSpanSchema,
  prerequisite_ids: z.array(ObligationIdSchema).readonly(),
  node_sha256: CertificationSha256Schema,
  source_context: z.string(),
}).strict().readonly()

const WitnessContextAssumptionSchema = z.object({
  assumption_id: AssumptionIdSchema,
  statement: NonBlankSchema,
  source_kind: z.enum(["ARTIFACT", "OBJECTIVE", "REFERENCE"]),
  source_id: NonBlankSchema,
  source_sha256: CertificationSha256Schema,
  source_span: CertificationSourceSpanSchema.nullable(),
  assumption_sha256: CertificationSha256Schema,
  source_context: z.string(),
}).strict().readonly()

const WitnessReferenceSchema = z.object({
  source_id: NonBlankSchema,
  source_sha256: CertificationSha256Schema,
  content: z.string(),
}).strict().readonly()

export const CertificationWitnessPayloadSchema = z.object({
  schema_version: z.literal(1),
  tool_policy: z.literal("deny_all"),
  attack_attempt_id: NonBlankSchema,
  target: WitnessContextNodeSchema,
  prerequisites: z.array(WitnessContextNodeSchema).readonly(),
  assumptions: z.array(WitnessContextAssumptionSchema).readonly(),
  witness: NonBlankSchema,
  artifact_sha256: CertificationSha256Schema,
  graph_sha256: CertificationSha256Schema,
  node_sha256: CertificationSha256Schema,
  witness_sha256: CertificationSha256Schema,
  references: z.array(WitnessReferenceSchema).readonly(),
}).strict().readonly()

export type CertificationWitnessPayload = z.infer<typeof CertificationWitnessPayloadSchema>

export function buildCertificationWitnessPayload(input: unknown): CertificationWitnessPayload {
  const parsed = BuildWitnessPayloadSchema.parse(input)
  CertificationGraphSourceValidationSchema.parse({ graph: parsed.graph, sources: parsed.sources })
  if (parsed.attack.outcome !== "COUNTEREXAMPLE_FOUND") throw new CertificationWitnessPayloadBindingError()
  const target = parsed.graph.nodes.find((node) => node.obligation_id === parsed.attack.obligation_id)
  if (target === undefined || parsed.attack.node_sha256 !== target.node_sha256
    || parsed.attack.graph_sha256 !== parsed.graph.graph_sha256
    || parsed.attack.artifact_sha256 !== parsed.graph.artifact.artifact_sha256) {
    throw new CertificationWitnessPayloadBindingError()
  }
  const closure = certificationPrerequisiteClosureIds(parsed.graph, [target.obligation_id])
  const prerequisites = parsed.graph.nodes.filter((node) => node.obligation_id !== target.obligation_id && closure.has(node.obligation_id))
  const relevantNodes = [target, ...prerequisites]
  const assumptionIds = new Set(relevantNodes.flatMap((node) => node.assumption_bindings.map((binding) => binding.assumption_id)))
  const assumptions = parsed.graph.assumptions.filter((assumption) => assumptionIds.has(assumption.assumption_id))
  const referenceIds = new Set(assumptions.flatMap((assumption) => assumption.source_kind === "REFERENCE" ? [assumption.source_id] : []))
  return CertificationWitnessPayloadSchema.parse({
    schema_version: 1,
    tool_policy: "deny_all",
    attack_attempt_id: parsed.attack.attack_attempt_id,
    target: contextNode(target, parsed.sources.artifact_content),
    prerequisites: prerequisites.map((node) => contextNode(node, parsed.sources.artifact_content)),
    assumptions: assumptions.map((assumption) => ({
      ...assumption,
      source_context: assumptionContext(assumption, parsed.sources),
    })),
    witness: parsed.attack.witness,
    artifact_sha256: parsed.attack.artifact_sha256,
    graph_sha256: parsed.attack.graph_sha256,
    node_sha256: parsed.attack.node_sha256,
    witness_sha256: parsed.attack.witness_sha256,
    references: parsed.sources.references.filter((reference) => referenceIds.has(reference.source_id)),
  })
}

function contextNode(node: z.infer<typeof CertificationObligationNodeSchema>, content: string) {
  return {
    obligation_id: node.obligation_id,
    kind: node.kind,
    statement: node.statement,
    source_span: node.source_span,
    prerequisite_ids: node.prerequisite_ids,
    node_sha256: node.node_sha256,
    source_context: exactSpan(content, node.source_span.start_byte, node.source_span.end_byte),
  }
}

function assumptionContext(
  assumption: z.infer<typeof CertificationAssumptionSchema>,
  sources: z.infer<typeof CertificationGraphSourcesSchema>,
): string {
  let content: string
  switch (assumption.source_kind) {
    case "ARTIFACT": content = sources.artifact_content; break
    case "OBJECTIVE": content = sources.objective_content; break
    case "REFERENCE": {
      const reference = sources.references.find((candidate) => candidate.source_id === assumption.source_id)
      if (reference === undefined) throw new CertificationWitnessPayloadBindingError()
      content = reference.content
      break
    }
    default: return assertNever(assumption.source_kind)
  }
  return assumption.source_span === null
    ? content
    : exactSpan(content, assumption.source_span.start_byte, assumption.source_span.end_byte)
}

function exactSpan(content: string, startByte: number, endByte: number): string {
  return Buffer.from(content, "utf8").subarray(startByte, endByte).toString("utf8")
}

export class CertificationWitnessPayloadBindingError extends Error {
  readonly name = "CertificationWitnessPayloadBindingError"

  constructor() {
    super("Witness payload does not match the exact source-bound found attack")
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected witness assumption source: ${String(value)}`)
}
