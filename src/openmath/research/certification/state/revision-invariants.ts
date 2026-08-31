import type { z } from "zod"

import type { CertificationAggregateInvariantInput } from "./aggregate-invariant-input"

export function validateCertificationRevisions(state: CertificationAggregateInvariantInput, context: z.RefinementCtx): void {
  if (state.certification_revision === 0) validateInitialRevision(state, context)
  validateOrdered(state.coverage_reviews.map((item) => item.certification_revision), state, "coverage_reviews", context)
  validateOrdered(state.attack_attempts.map((item) => item.certification_revision), state, "attack_attempts", context)
  validateOrdered(state.witness_verifications.map((item) => item.certification_revision), state, "witness_verifications", context)
  validateOrdered(state.evidence_receipts.map((item) => item.certification_revision), state, "evidence_receipts", context)
  validateOrdered(state.amendments.map((item) => item.certification_revision), state, "amendments", context)
  validateOrdered(state.job_attempts.map((item) => item.prepared_at_revision), state, "job_attempts", context)
  for (const [index, job] of state.job_attempts.entries()) {
    if (job.phase_revision > state.certification_revision) addIssue(context, "job_attempts", index, "Job phase revision exceeds state")
    const previous = state.job_attempts[index - 1]
    if (previous !== undefined && previous.prepared_at_revision === job.prepared_at_revision && previous.job_id > job.job_id) {
      addIssue(context, "job_attempts", index, "Jobs at the same revision must use canonical ID ordering")
    }
  }
}

function validateInitialRevision(state: CertificationAggregateInvariantInput, context: z.RefinementCtx): void {
  const recordCount = state.graphs.length + state.coverage_reviews.length + state.attack_attempts.length
    + state.witness_verifications.length + state.evidence_receipts.length + state.amendments.length + state.job_attempts.length
  if (state.phase !== "EXTRACTION" || state.status !== "READY" || recordCount !== 0) {
    context.addIssue({ code: "custom", path: ["certification_revision"], message: "Revision zero must be the empty initialized EXTRACTION/READY state" })
  }
}

function validateOrdered(
  revisions: readonly number[],
  state: CertificationAggregateInvariantInput,
  path: string,
  context: z.RefinementCtx,
): void {
  let previous = -1
  for (const [index, revision] of revisions.entries()) {
    if (revision < previous) addIssue(context, path, index, "Certification revisions must be append ordered")
    if (revision > state.certification_revision) addIssue(context, path, index, "Record revision exceeds certification state")
    previous = revision
  }
}

function addIssue(context: z.RefinementCtx, path: string, index: number, message: string): void {
  context.addIssue({ code: "custom", path: [path, index], message })
}
