import { z } from "zod"

import { sha256 } from "../../../workflow/stage-runner/sha256"
import { compareCodeUnits, normalizeCertificationText } from "./canonical-text"
import {
  CertificationJobIdSchema,
  CertificationRevisionSchema,
  CertificationSha256Schema,
  CoverageReviewIdSchema,
  ObligationIdSchema,
} from "./literals"
import { CertificationSourceSpanSchema } from "./source-span"

export const CoverageVerdictSchema = z.enum(["PASS", "REVISE", "INCONCLUSIVE"])

export const CoverageFindingSchema = z.object({
  kind: z.enum(["MISSING_CLAIM", "MISSING_DEPENDENCY", "MISSING_ASSUMPTION", "WRONG_REQUIREDNESS", "SOURCE_BINDING"]),
  source_span: CertificationSourceSpanSchema.nullable(),
  obligation_ids: z.array(ObligationIdSchema).superRefine((ids, context) => {
    if (new Set(ids).size !== ids.length || ids.some((id, index) => index > 0 && (ids[index - 1] ?? "") > id)) {
      context.addIssue({ code: "custom", message: "Coverage obligation IDs must be sorted and unique" })
    }
  }).readonly(),
  message: z.string().min(1).max(2000).refine((value) => value === normalizeCertificationText(value)),
  suggested_correction: z.string().min(1).max(2000).refine((value) => value === normalizeCertificationText(value)),
}).strict().readonly()

export const CoverageReviewSchema = z.object({
  coverage_review_id: CoverageReviewIdSchema,
  certification_revision: CertificationRevisionSchema,
  job_id: CertificationJobIdSchema,
  coverage_round: z.number().int().positive().max(5),
  artifact_sha256: CertificationSha256Schema,
  graph_sha256: CertificationSha256Schema,
  verdict: CoverageVerdictSchema,
  findings: z.array(CoverageFindingSchema).max(256).readonly(),
}).strict().superRefine((review, context) => {
  const expectedId = `coverage-${String(review.coverage_round).padStart(4, "0")}`
  if (review.coverage_review_id !== expectedId) context.addIssue({ code: "custom", path: ["coverage_review_id"], message: "Coverage ID must match round" })
  if (review.findings.some((finding, index) => index > 0 && compareCoverageFindings(review.findings[index - 1], finding) > 0)) context.addIssue({ code: "custom", path: ["findings"], message: "Coverage findings must use canonical ordering" })
}).readonly()

export function compareCoverageFindings(left: z.infer<typeof CoverageFindingSchema> | undefined, right: z.infer<typeof CoverageFindingSchema>): number {
  if (left === undefined) return 0
  return compareCodeUnits(left.kind, right.kind)
    || (left.source_span?.start_byte ?? -1) - (right.source_span?.start_byte ?? -1)
    || (left.source_span?.end_byte ?? -1) - (right.source_span?.end_byte ?? -1)
    || compareCodeUnits(JSON.stringify(left.obligation_ids), JSON.stringify(right.obligation_ids))
    || compareCodeUnits(left.message, right.message)
    || compareCodeUnits(left.suggested_correction, right.suggested_correction)
}

export function hashCoverageReview(review: z.infer<typeof CoverageReviewSchema>): string {
  return sha256(JSON.stringify(review))
}

export type CoverageReview = z.infer<typeof CoverageReviewSchema>
