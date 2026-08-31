import { z } from "zod"

import { CertificationAssumptionSchema } from "../state/assumptions"
import { CertificationAttackModeSchema } from "../state/attacks"
import { CoverageReviewSchema } from "../state/coverage"
import { CertificationGraphSchema, CertificationObligationKindSchema, CertificationObligationNodeSchema } from "../state/graph"
import { CertificationGraphSourcesSchema, CertificationGraphSourceValidationSchema } from "../state/graph-source-validation"
import { certificationPrerequisiteClosureIds } from "../state/graph-invariants"
import {
  AssumptionIdSchema,
  CertificationSha256Schema,
  NonBlankSchema,
  ObligationIdSchema,
} from "../state/literals"
import { CertificationSourceSpanSchema } from "../state/source-span"
import {
  buildCertificationAttackPlan,
  CertificationAttackPlannerProfileSchema,
  CertificationAttackPlanEntrySchema,
} from "../scheduler/attack-planner"

const ContextNodeSchema = z.object({
  obligation_id: ObligationIdSchema,
  kind: CertificationObligationKindSchema,
  statement: NonBlankSchema,
  source_span: CertificationSourceSpanSchema,
  prerequisite_ids: z.array(ObligationIdSchema).readonly(),
  node_sha256: CertificationSha256Schema,
  source_context: z.string(),
}).strict().readonly()

const ContextAssumptionSchema = z.object({
  assumption_id: AssumptionIdSchema,
  statement: NonBlankSchema,
  source_kind: z.enum(["ARTIFACT", "OBJECTIVE", "REFERENCE"]),
  source_id: NonBlankSchema,
  source_sha256: CertificationSha256Schema,
  source_span: CertificationSourceSpanSchema.nullable(),
  assumption_sha256: CertificationSha256Schema,
  source_context: z.string(),
}).strict().readonly()

export const CertificationAttackPayloadSchema = z.object({
  schema_version: z.literal(1),
  tool_policy: z.literal("deny_all"),
  target: ContextNodeSchema,
  prerequisites: z.array(ContextNodeSchema).readonly(),
  assumptions: z.array(ContextAssumptionSchema).readonly(),
  graph_sha256: CertificationSha256Schema,
  artifact_sha256: CertificationSha256Schema,
  mode: CertificationAttackModeSchema,
  bounds: z.object({
    coverage_round: z.number().int().positive().max(5),
    call_ordinal: z.number().int().positive(),
    mode_ordinal: z.number().int().positive().max(7),
    max_attacks_per_obligation: z.number().int().positive().max(7),
  }).strict().readonly(),
}).strict().readonly()

const BuildAttackPayloadSchema = z.object({
  graph: CertificationGraphSchema,
  sources: CertificationGraphSourcesSchema,
  coverage: CoverageReviewSchema,
  profile: CertificationAttackPlannerProfileSchema,
  attempt: CertificationAttackPlanEntrySchema,
}).strict().readonly()

export type CertificationAttackPayload = z.infer<typeof CertificationAttackPayloadSchema>

export function buildCertificationAttackPayload(
  input: unknown,
): CertificationAttackPayload {
  const parsed = BuildAttackPayloadSchema.parse(input)
  CertificationGraphSourceValidationSchema.parse({ graph: parsed.graph, sources: parsed.sources })
  if (parsed.coverage.verdict !== "PASS" || parsed.coverage.graph_sha256 !== parsed.graph.graph_sha256
    || parsed.coverage.artifact_sha256 !== parsed.graph.artifact.artifact_sha256) throw new CertificationAttackPayloadBindingError()
  const canonical = buildCertificationAttackPlan({ graph: parsed.graph, coverage: parsed.coverage, profile: parsed.profile })
    .find((attempt) => attempt.attack_attempt_id === parsed.attempt.attack_attempt_id)
  if (canonical === undefined || JSON.stringify(canonical) !== JSON.stringify(parsed.attempt)) throw new CertificationAttackPayloadBindingError()
  const target = parsed.graph.nodes.find((node) => node.obligation_id === parsed.attempt.obligation_id)
  if (target === undefined || target.node_sha256 !== parsed.attempt.node_sha256) throw new CertificationAttackPayloadBindingError()
  const closure = certificationPrerequisiteClosureIds(parsed.graph, [target.obligation_id])
  const prerequisites = parsed.graph.nodes.filter((node) => node.obligation_id !== target.obligation_id && closure.has(node.obligation_id))
  const relevantNodes = [target, ...prerequisites]
  const assumptionIds = new Set(relevantNodes.flatMap((node) => node.assumption_bindings.map((binding) => binding.assumption_id)))
  return CertificationAttackPayloadSchema.parse({
    schema_version: 1,
    tool_policy: "deny_all",
    target: contextNode(target, parsed.sources.artifact_content),
    prerequisites: prerequisites.map((node) => contextNode(node, parsed.sources.artifact_content)),
    assumptions: parsed.graph.assumptions.filter((assumption) => assumptionIds.has(assumption.assumption_id)).map((assumption) => ({
      ...assumption,
      source_context: assumptionSourceContext(assumption, parsed.sources),
    })),
    graph_sha256: parsed.graph.graph_sha256,
    artifact_sha256: parsed.graph.artifact.artifact_sha256,
    mode: parsed.attempt.mode,
    bounds: {
      coverage_round: parsed.attempt.bounds.coverage_round,
      call_ordinal: parsed.attempt.ordinal,
      mode_ordinal: parsed.attempt.bounds.mode_ordinal,
      max_attacks_per_obligation: parsed.attempt.bounds.max_attacks_per_obligation,
    },
  })
}

function contextNode(node: z.infer<typeof CertificationObligationNodeSchema>, artifactContent: string) {
  return {
    obligation_id: node.obligation_id,
    kind: node.kind,
    statement: node.statement,
    source_span: node.source_span,
    prerequisite_ids: node.prerequisite_ids,
    node_sha256: node.node_sha256,
    source_context: exactSpan(artifactContent, node.source_span.start_byte, node.source_span.end_byte),
  }
}

function assumptionSourceContext(
  assumption: z.infer<typeof CertificationAssumptionSchema>,
  sources: z.infer<typeof CertificationGraphSourcesSchema>,
): string {
  let content: string
  switch (assumption.source_kind) {
    case "ARTIFACT": content = sources.artifact_content; break
    case "OBJECTIVE": content = sources.objective_content; break
    case "REFERENCE": {
      const reference = sources.references.find((candidate) => candidate.source_id === assumption.source_id)
      if (reference === undefined) throw new CertificationAttackPayloadBindingError()
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

export class CertificationAttackPayloadBindingError extends Error {
  readonly name = "CertificationAttackPayloadBindingError"

  constructor() {
    super("Attack payload target does not match the source-bound graph")
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected attack assumption source: ${String(value)}`)
}
