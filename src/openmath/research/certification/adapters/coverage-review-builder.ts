import { z } from "zod"

import { CoverageReviewSchema, type CoverageReview } from "../state/coverage"
import { CoverageSourceValidationSchema } from "../state/coverage-source-validation"
import { CertificationGraphSourceValidationSchema, CertificationGraphSourcesSchema } from "../state/graph-source-validation"
import { CertificationJobIdSchema, CertificationRevisionSchema, CoverageReviewIdSchema } from "../state/literals"
import { CoverageInputSchema } from "./coverage-input"
import { CoverageModelOutputSchema } from "./coverage-model-output"

const BuildCoverageReviewSchema = z.object({
  output: CoverageModelOutputSchema,
  input: CoverageInputSchema,
  sources: CertificationGraphSourcesSchema,
  coverage_review_id: CoverageReviewIdSchema,
  certification_revision: CertificationRevisionSchema,
  job_id: CertificationJobIdSchema,
  coverage_round: z.number().int().positive().max(5),
}).strict().readonly()

export type CoverageReviewBuildResult = Readonly<{
  readonly coverage: CoverageReview
  readonly evidence_type: "LLM_REVIEW"
}>

export function buildCoverageReview(
  input: z.input<typeof BuildCoverageReviewSchema>,
): CoverageReviewBuildResult {
  const parsed = BuildCoverageReviewSchema.parse(input)
  CertificationGraphSourceValidationSchema.parse({ graph: parsed.input.graph, sources: parsed.sources })
  const knownObligations = new Set(parsed.input.graph.nodes.map((node) => node.obligation_id))
  if (parsed.output.findings.some((finding) => finding.obligation_ids.some((id) => !knownObligations.has(id)))) {
    throw new CoverageReviewBindingError()
  }
  const coverage = CoverageReviewSchema.parse({
    coverage_review_id: parsed.coverage_review_id,
    certification_revision: parsed.certification_revision,
    job_id: parsed.job_id,
    coverage_round: parsed.coverage_round,
    artifact_sha256: parsed.input.graph.artifact.artifact_sha256,
    graph_sha256: parsed.input.graph.graph_sha256,
    verdict: parsed.output.verdict,
    findings: parsed.output.findings,
  })
  CoverageSourceValidationSchema.parse({ coverage, artifact_content: parsed.input.artifact.content })
  return { coverage, evidence_type: "LLM_REVIEW" }
}

export class CoverageReviewBindingError extends Error {
  readonly name = "CoverageReviewBindingError"

  constructor() {
    super("Coverage review references an obligation outside the canonical graph")
  }
}
