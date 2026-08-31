import { z } from "zod"

import { ResearchCertificationStateV1Schema } from "./schema"

const HISTORY_FIELDS = [
  "graphs",
  "coverage_reviews",
  "attack_attempts",
  "witness_verifications",
  "evidence_receipts",
  "amendments",
  "job_attempts",
] as const

export const CertificationStateMutationSchema = z.object({
  previous: ResearchCertificationStateV1Schema,
  next: ResearchCertificationStateV1Schema,
}).strict().superRefine(({ previous, next }, context) => {
  if (previous.status === "ABORTED" || previous.status === "COMPLETE") {
    context.addIssue({ code: "custom", path: ["previous", "status"], message: "Terminal certification states cannot mutate" })
    return
  }
  if (next.certification_revision !== previous.certification_revision + 1) context.addIssue({ code: "custom", path: ["next", "certification_revision"], message: "Certification revision must advance exactly once" })
  const identityMatches = previous.certification_id === next.certification_id
    && previous.generation_id === next.generation_id
    && previous.campaign_id === next.campaign_id
    && JSON.stringify(previous.selected_artifact) === JSON.stringify(next.selected_artifact)
    && previous.objective_sha256 === next.objective_sha256
    && previous.profile_sha256 === next.profile_sha256
    && previous.reference_sha256 === next.reference_sha256
    && previous.certification_profile_sha256 === next.certification_profile_sha256
  if (!identityMatches) context.addIssue({ code: "custom", path: ["next"], message: "Certification generation identity is immutable" })
  for (const field of HISTORY_FIELDS) {
    const prior = previous[field]
    const nextPrefix = next[field].slice(0, prior.length)
    if (JSON.stringify(prior) !== JSON.stringify(nextPrefix)) context.addIssue({ code: "custom", path: ["next", field], message: "Certification histories are append-only" })
  }
}).readonly()
