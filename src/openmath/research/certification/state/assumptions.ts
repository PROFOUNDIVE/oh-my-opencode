import { z } from "zod"

import { normalizeCertificationText } from "./canonical-text"
import { AssumptionIdSchema, CertificationSha256Schema, NonBlankSchema } from "./literals"
import { CertificationSourceSpanSchema } from "./source-span"

export const CertificationAssumptionSchema = z.object({
  assumption_id: AssumptionIdSchema,
  statement: NonBlankSchema.refine((value) => value === normalizeCertificationText(value)),
  source_kind: z.enum(["ARTIFACT", "OBJECTIVE", "REFERENCE"]),
  source_id: NonBlankSchema,
  source_sha256: CertificationSha256Schema,
  source_span: CertificationSourceSpanSchema.nullable(),
  assumption_sha256: CertificationSha256Schema,
}).strict().readonly()

export const CertificationAssumptionBindingSchema = z.object({
  assumption_id: AssumptionIdSchema,
  assumption_sha256: CertificationSha256Schema,
}).strict().readonly()

export type CertificationAssumption = z.infer<typeof CertificationAssumptionSchema>
export type CertificationAssumptionBinding = z.infer<typeof CertificationAssumptionBindingSchema>
