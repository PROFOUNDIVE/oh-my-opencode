import { z } from "zod"

import { sha256 } from "../../../workflow/stage-runner/sha256"
import { CertificationGraphSchema } from "../state/graph"
import {
  CertificationGraphSourceValidationSchema,
  CertificationGraphSourcesSchema,
} from "../state/graph-source-validation"
import { sourceSpanError } from "../state/source-span"

export const CoverageInputSchema = z.object({
  artifact: z.object({
    media_type: z.enum(["text/markdown", "application/vnd.openmath.legacy+json"]),
    content: z.string(),
  }).strict().readonly(),
  graph: CertificationGraphSchema,
  max_findings: z.number().int().min(1).max(256),
}).strict().superRefine((input, context) => {
  if (sha256(input.artifact.content) !== input.graph.artifact.artifact_sha256) {
    context.addIssue({ code: "custom", path: ["artifact", "content"], message: "Coverage artifact bytes must match the graph" })
  }
  if (input.artifact.media_type !== input.graph.artifact.media_type) {
    context.addIssue({ code: "custom", path: ["artifact", "media_type"], message: "Coverage media type must match the graph" })
  }
  for (const [index, node] of input.graph.nodes.entries()) {
    const error = sourceSpanError(input.artifact.content, node.source_span)
    if (error !== null) context.addIssue({ code: "custom", path: ["graph", "nodes", index, "source_span"], message: error })
  }
}).readonly()

const BuildCoverageInputSchema = z.object({
  graph: CertificationGraphSchema,
  sources: CertificationGraphSourcesSchema,
  max_findings: z.number().int().min(1).max(256),
}).strict().readonly()

export type CoverageInput = z.infer<typeof CoverageInputSchema>

export function buildCoverageInput(input: z.input<typeof BuildCoverageInputSchema>): CoverageInput {
  const parsed = BuildCoverageInputSchema.parse(input)
  CertificationGraphSourceValidationSchema.parse({ graph: parsed.graph, sources: parsed.sources })
  return CoverageInputSchema.parse({
    artifact: { media_type: parsed.sources.artifact.media_type, content: parsed.sources.artifact_content },
    graph: parsed.graph,
    max_findings: parsed.max_findings,
  })
}
