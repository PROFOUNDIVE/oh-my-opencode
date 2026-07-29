import { z } from "zod"
import { REFERENCE_ROLES, REFERENCE_STAGES } from "./types"

export const ReferenceManifestEntrySchema = z.object({
  id: z.string().trim().min(1),
  path: z.string().trim().min(1),
  role: z.enum(REFERENCE_ROLES),
  stages: z.array(z.enum(REFERENCE_STAGES)).min(1).refine(
    (stages) => new Set(stages).size === stages.length,
    "Reference stages must not repeat",
  ),
  required: z.boolean().default(true),
}).strict()

export const ReferenceManifestV1Schema = z.object({
  version: z.literal(1),
  references: z.array(ReferenceManifestEntrySchema),
}).strict()
