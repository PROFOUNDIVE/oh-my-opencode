import { z } from "zod"

import { CertificationObligationKindSchema } from "../state/graph"
import { NonBlankSchema } from "../state/literals"
import { CertificationSourceSpanSchema } from "../state/source-span"

const ModelAssumptionBaseSchema = z.object({
  local_id: NonBlankSchema,
  statement: NonBlankSchema,
  source_span: CertificationSourceSpanSchema.nullable(),
})

const ExtractionModelAssumptionSchema = z.discriminatedUnion("source_kind", [
  ModelAssumptionBaseSchema.extend({ source_kind: z.literal("ARTIFACT") }).strict(),
  ModelAssumptionBaseSchema.extend({ source_kind: z.literal("OBJECTIVE") }).strict(),
  ModelAssumptionBaseSchema.extend({
    source_kind: z.literal("REFERENCE"),
    source_id: NonBlankSchema,
  }).strict(),
]).readonly()

const ExtractionModelNodeSchema = z.object({
  local_id: NonBlankSchema,
  kind: CertificationObligationKindSchema,
  source_span: CertificationSourceSpanSchema,
  statement: NonBlankSchema,
  prerequisite_local_ids: z.array(NonBlankSchema).readonly(),
  assumption_local_ids: z.array(NonBlankSchema).readonly(),
  required: z.boolean(),
}).strict().readonly()

export const ExtractionModelOutputSchema = z.object({
  assumptions: z.array(ExtractionModelAssumptionSchema).max(256).readonly(),
  nodes: z.array(ExtractionModelNodeSchema).min(1).max(256).readonly(),
  required_root_local_ids: z.array(NonBlankSchema).min(1).readonly(),
}).strict().superRefine((output, context) => {
  addUniqueIssue(output.assumptions.map((assumption) => assumption.local_id), "assumptions", context)
  addUniqueIssue(output.nodes.map((node) => node.local_id), "nodes", context)
}).readonly()

function addUniqueIssue(values: readonly string[], path: string, context: z.RefinementCtx): void {
  if (new Set(values).size !== values.length) {
    context.addIssue({ code: "custom", path: [path], message: "Temporary local IDs must be unique" })
  }
}

export type ExtractionModelOutput = z.infer<typeof ExtractionModelOutputSchema>
