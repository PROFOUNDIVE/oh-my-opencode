import { z } from "zod"

import {
  CertificationGraphSourcesSchema,
} from "../state/graph-source-validation"

export const ExtractionInputSchema = z.object({
  artifact: z.object({
    media_type: z.enum(["text/markdown", "application/vnd.openmath.legacy+json"]),
    content: z.string(),
  }).strict().readonly(),
  objective: z.object({ source_id: z.literal("objective"), content: z.string() }).strict().readonly(),
  references: z.array(z.object({ source_id: z.string().min(1), content: z.string() }).strict().readonly()).readonly(),
}).strict().readonly()

export type ExtractionInput = z.infer<typeof ExtractionInputSchema>

export type BuildExtractionInput = Readonly<z.input<typeof CertificationGraphSourcesSchema>>

export function buildExtractionInput(input: BuildExtractionInput): ExtractionInput {
  const sources = CertificationGraphSourcesSchema.parse({
    artifact: input.artifact,
    artifact_content: input.artifact_content,
    objective_sha256: input.objective_sha256,
    objective_content: input.objective_content,
    references: input.references,
  })
  return ExtractionInputSchema.parse({
    artifact: { media_type: sources.artifact.media_type, content: sources.artifact_content },
    objective: { source_id: "objective", content: sources.objective_content },
    references: sources.references.map((reference) => ({
      source_id: reference.source_id,
      content: reference.content,
    })),
  })
}
