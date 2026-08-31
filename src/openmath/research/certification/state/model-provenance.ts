import { z } from "zod"

import { NonBlankSchema } from "./literals"

export const CertificationResolvedModelSchema = z.object({
  providerID: z.string().regex(/^\S+$/),
  modelID: z.string().regex(/^\S+$/),
  variant: NonBlankSchema.optional(),
}).strict().readonly()

export type CertificationResolvedModel = z.infer<typeof CertificationResolvedModelSchema>
