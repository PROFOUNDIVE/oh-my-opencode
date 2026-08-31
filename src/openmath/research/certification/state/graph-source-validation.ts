import { z } from "zod"

import { sha256 } from "../../../workflow/stage-runner/sha256"
import { normalizeCertificationText } from "./canonical-text"
import { CertificationGraphSchema, type CertificationGraph } from "./graph"
import { CertificationSelectedArtifactSchema } from "./identity"
import { CertificationSha256Schema, NonBlankSchema } from "./literals"
import { sourceSpanError } from "./source-span"

const FrozenReferenceSourceSchema = z.object({
  source_id: NonBlankSchema,
  source_sha256: CertificationSha256Schema,
  content: z.string(),
}).strict().readonly()

export const CertificationGraphSourcesSchema = z.object({
  artifact: CertificationSelectedArtifactSchema,
  artifact_content: z.string(),
  objective_sha256: CertificationSha256Schema,
  objective_content: z.string(),
  references: z.array(FrozenReferenceSourceSchema).readonly(),
}).strict().superRefine((sources, context) => {
  if (new Set(sources.references.map((reference) => reference.source_id)).size !== sources.references.length) {
    addIssue(context, ["references"], "Frozen reference IDs must be unique")
  }
  if (sha256(sources.artifact_content) !== sources.artifact.artifact_sha256) addIssue(context, ["artifact_content"], "Artifact hash must bind exact content")
  if (sha256(sources.objective_content) !== sources.objective_sha256) addIssue(context, ["objective_content"], "Objective hash must bind exact content")
  for (const [index, reference] of sources.references.entries()) {
    if (sha256(reference.content) !== reference.source_sha256) addIssue(context, ["references", index, "content"], "Reference hash must bind exact content")
  }
}).readonly()

type CertificationGraphSources = z.infer<typeof CertificationGraphSourcesSchema>
export type { CertificationGraphSources }
type CertificationGraphSourceValidationInput = Readonly<{
  readonly graph: CertificationGraph
  readonly sources: CertificationGraphSources
}>

export const CertificationGraphSourceValidationSchema = z.object({
  graph: CertificationGraphSchema,
  sources: CertificationGraphSourcesSchema,
}).strict().superRefine((input, context) => {
  if (JSON.stringify(input.graph.artifact) !== JSON.stringify(input.sources.artifact)) addIssue(context, ["graph", "artifact"], "Graph artifact must match selected artifact")
  const references = new Map(input.sources.references.map((reference) => [reference.source_id, reference]))
  for (const [index, node] of input.graph.nodes.entries()) {
    const error = sourceSpanError(input.sources.artifact_content, node.source_span)
    if (error !== null) addIssue(context, ["graph", "nodes", index, "source_span"], error)
    else if (normalizeCertificationText(sourceSpanText(input.sources.artifact_content, node.source_span)) !== node.statement) {
      addIssue(context, ["graph", "nodes", index, "statement"], "Node statement must equal its exact source span")
    }
  }
  for (const [index, assumption] of input.graph.assumptions.entries()) {
    validateAssumptionSource(input, references, assumption, index, context)
  }
}).readonly()

function validateAssumptionSource(
  input: CertificationGraphSourceValidationInput,
  references: ReadonlyMap<string, z.infer<typeof FrozenReferenceSourceSchema>>,
  assumption: z.infer<typeof CertificationGraphSchema>["assumptions"][number],
  index: number,
  context: z.RefinementCtx,
): void {
  let content: string | null = null
  switch (assumption.source_kind) {
    case "ARTIFACT":
      if (assumption.source_id !== input.graph.artifact.candidate_id || assumption.source_sha256 !== input.graph.artifact.artifact_sha256) addIssue(context, ["graph", "assumptions", index], "Artifact assumption must bind selected candidate and hash")
      content = input.sources.artifact_content
      break
    case "OBJECTIVE":
      if (assumption.source_id !== "objective" || assumption.source_sha256 !== input.sources.objective_sha256) addIssue(context, ["graph", "assumptions", index], "Objective assumption must bind objective identity and hash")
      content = input.sources.objective_content
      break
    case "REFERENCE": {
      const reference = references.get(assumption.source_id)
      if (reference === undefined || reference.source_sha256 !== assumption.source_sha256) addIssue(context, ["graph", "assumptions", index], "Reference assumption must bind a frozen reference")
      content = reference?.content ?? null
      break
    }
    default:
      assertNever(assumption.source_kind)
  }
  if (content !== null && assumption.source_span !== null) {
    const error = sourceSpanError(content, assumption.source_span)
    if (error !== null) addIssue(context, ["graph", "assumptions", index, "source_span"], error)
    else if (normalizeCertificationText(sourceSpanText(content, assumption.source_span)) !== assumption.statement) {
      addIssue(context, ["graph", "assumptions", index, "statement"], "Assumption statement must equal its exact source span")
    }
  }
}

function sourceSpanText(content: string, span: Parameters<typeof sourceSpanError>[1]): string {
  return Buffer.from(content, "utf8").subarray(span.start_byte, span.end_byte).toString("utf8")
}

function addIssue(context: z.RefinementCtx, path: readonly (string | number)[], message: string): void {
  context.addIssue({ code: "custom", path: [...path], message })
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected assumption source kind: ${String(value)}`)
}
