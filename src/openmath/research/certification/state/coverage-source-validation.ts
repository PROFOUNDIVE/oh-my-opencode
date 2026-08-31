import { z } from "zod"

import { sha256 } from "../../../workflow/stage-runner/sha256"
import { CoverageReviewSchema } from "./coverage"
import { sourceSpanError } from "./source-span"

export const CoverageSourceValidationSchema = z.object({
  coverage: CoverageReviewSchema,
  artifact_content: z.string(),
}).strict().superRefine((input, context) => {
  if (sha256(input.artifact_content) !== input.coverage.artifact_sha256) {
    context.addIssue({ code: "custom", path: ["artifact_content"], message: "Coverage artifact hash must bind exact content" })
  }
  for (const [index, finding] of input.coverage.findings.entries()) {
    if (finding.source_span === null) continue
    const error = sourceSpanError(input.artifact_content, finding.source_span)
    if (error !== null) context.addIssue({ code: "custom", path: ["coverage", "findings", index, "source_span"], message: error })
  }
}).readonly()
