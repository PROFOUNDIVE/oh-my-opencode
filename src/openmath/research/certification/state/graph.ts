import { z } from "zod"

import { CertificationAssumptionBindingSchema, CertificationAssumptionSchema } from "./assumptions"
import { CertificationSelectedArtifactSchema } from "./identity"
import { CertificationSha256Schema, ObligationIdSchema } from "./literals"
import { normalizeCertificationText } from "./canonical-text"
import { CertificationSourceSpanSchema } from "./source-span"
import { validateCertificationGraph } from "./graph-invariants"

export const CertificationObligationKindSchema = z.enum([
  "THEOREM",
  "LEMMA",
  "CLAIM",
  "DEFINITION",
  "IMPORTED_RESULT",
  "COMPUTATION",
])

export const CertificationObligationNodeSchema = z.object({
  obligation_id: ObligationIdSchema,
  kind: CertificationObligationKindSchema,
  source_span: CertificationSourceSpanSchema,
  statement: z.string().min(1).refine((value) => value === normalizeCertificationText(value)),
  prerequisite_ids: z.array(ObligationIdSchema).readonly(),
  assumption_bindings: z.array(CertificationAssumptionBindingSchema).readonly(),
  required: z.boolean(),
  node_sha256: CertificationSha256Schema,
}).strict().readonly()

export const CertificationGraphSchema = z.object({
  schema_version: z.literal(1),
  artifact: CertificationSelectedArtifactSchema,
  assumptions: z.array(CertificationAssumptionSchema).readonly(),
  nodes: z.array(CertificationObligationNodeSchema).min(1).max(256).readonly(),
  required_root_ids: z.array(ObligationIdSchema).min(1).readonly(),
  graph_sha256: CertificationSha256Schema,
}).strict().superRefine(validateCertificationGraph).readonly()

export type CertificationObligationKind = z.infer<typeof CertificationObligationKindSchema>
export type CertificationObligationNode = z.infer<typeof CertificationObligationNodeSchema>
export type CertificationGraph = z.infer<typeof CertificationGraphSchema>
